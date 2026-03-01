/**
 * mockup_generator.ts — Automated Mockup Generator
 * Implements MockupAdapter interface with LocalCompositeAdapter (ImageMagick/Sharp)
 * and CanvaAdapter stub (requires CANVA_API_KEY)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { DesignBrief, MockupResult, MockupManifest } from "./types";
import { loadConfig, writeJson, slugify, makeFilename, log, fileExists } from "./utils";

interface MockupConfig {
  adapter: "local_composite" | "canva";
  templates: Record<string, {
    id: string;
    blank_image_path: string;
    product_type: string;
    color: string;
    view: string;
    print_zone: { x: number; y: number; width: number; height: number };
    warp_mode: string;
  }>;
  per_design_variants: string[];
  output_path_template: string;
  filename_template: string;
}

/** MockupAdapter interface */
interface MockupAdapter {
  generate(brief: DesignBrief, designImagePath: string, templateId: string, outputPath: string): Promise<MockupResult>;
}

/** LocalCompositeAdapter — uses ImageMagick (convert command) */
class LocalCompositeAdapter implements MockupAdapter {
  private config: MockupConfig;

  constructor(config: MockupConfig) {
    this.config = config;
  }

  async generate(
    brief: DesignBrief,
    designImagePath: string,
    templateId: string,
    outputPath: string
  ): Promise<MockupResult> {
    const template = this.config.templates[templateId];
    if (!template) throw new Error(`Template not found: ${templateId}`);

    const blanksDir = path.join(process.cwd(), "assets", "mockups", "blanks");
    const blankPath = path.join(process.cwd(), template.blank_image_path);

    // If blank doesn't exist, create a placeholder
    if (!fileExists(blankPath)) {
      this.createPlaceholderBlank(blankPath, template.color, template.view);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Check if ImageMagick is available
    const hasImageMagick = this.checkImageMagick();

    if (hasImageMagick && fileExists(designImagePath)) {
      this.compositeWithImageMagick(blankPath, designImagePath, template.print_zone, outputPath);
    } else {
      // Fallback: copy placeholder blank
      this.createCompositeWithText(blankPath, brief.phrase, template, outputPath);
    }

    return {
      concept_id: brief.concept_id,
      design_slug: slugify(brief.phrase),
      variant_label: brief.variant_label,
      mockup_type: template.view === "flatlay" ? "flatlay" : "front_on_model",
      blank: template.blank_image_path,
      color: template.color,
      file_path: outputPath,
      export_size: "2000x2000",
      status: fileExists(outputPath) ? "generated" : "placeholder",
    };
  }

  private checkImageMagick(): boolean {
    try {
      execSync("convert --version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  private compositeWithImageMagick(
    blankPath: string,
    designPath: string,
    printZone: { x: number; y: number; width: number; height: number },
    outputPath: string
  ): void {
    const { x, y, width, height } = printZone;
    const cmd = [
      "convert",
      `"${blankPath}"`,
      `"${designPath}" -resize ${width}x${height}`,
      `-gravity NorthWest -geometry +${x}+${y}`,
      "-composite",
      "-resize 2000x2000",
      `"${outputPath}"`,
    ].join(" ");
    execSync(cmd, { stdio: "pipe" });
  }

  private createPlaceholderBlank(outputPath: string, color: string, view: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const hasImageMagick = this.checkImageMagick();
    if (hasImageMagick) {
      const bgColor = color === "Black" || color === "Pepper" ? "#1A1A1A" :
        color === "White" || color === "Ivory" ? "#F5F0E8" : "#B8B8B8";
      const tshirtShape = view === "flatlay"
        ? `convert -size 2000x2000 xc:"${bgColor}" -fill none -stroke "#666" -strokewidth 2 "${outputPath}"`
        : `convert -size 2000x2000 xc:"${bgColor}" "${outputPath}"`;
      try { execSync(tshirtShape, { stdio: "pipe" }); } catch { /* ignore */ }
    }
    if (!fileExists(outputPath)) {
      // Write a 1x1 transparent PNG as absolute fallback
      const PNG_1x1 = Buffer.from(
        "89504e470d0a1a0a0000000d494844520000000100000001080200000090" +
        "7753de000000174944415478016360f8cfc00000000200016e21bc330000" +
        "0000049454e44ae426082",
        "hex"
      );
      fs.writeFileSync(outputPath, PNG_1x1);
    }
  }

  private createCompositeWithText(
    blankPath: string,
    phrase: string,
    template: MockupConfig["templates"][string],
    outputPath: string
  ): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const hasImageMagick = this.checkImageMagick();
    if (hasImageMagick && fileExists(blankPath)) {
      const textColor = template.color === "Black" || template.color === "Pepper" ? "white" : "black";
      const cmd = [
        "convert",
        `"${blankPath}"`,
        `-gravity Center`,
        `-font Helvetica-Bold`,
        `-pointsize 80`,
        `-fill ${textColor}`,
        `-annotate 0 "${phrase.replace(/"/g, "\\\"")}"`,
        `-resize 2000x2000`,
        `"${outputPath}"`,
      ].join(" ");
      try { execSync(cmd, { stdio: "pipe" }); } catch { /* fall through */ }
    }
    if (!fileExists(outputPath) && fileExists(blankPath)) {
      fs.copyFileSync(blankPath, outputPath);
    }
  }
}

/** CanvaAdapter — stub, requires Canva API key */
class CanvaAdapter implements MockupAdapter {
  async generate(): Promise<MockupResult> {
    throw new Error("CanvaAdapter requires CANVA_API_KEY. Set env var or switch to local_composite adapter.");
  }
}

/** Factory: pick adapter based on config */
function getAdapter(config: MockupConfig): MockupAdapter {
  if (config.adapter === "canva" && process.env.CANVA_API_KEY) {
    return new CanvaAdapter();
  }
  return new LocalCompositeAdapter(config);
}

/** Select best template for a brief variant */
function selectTemplate(brief: DesignBrief, viewType: string, config: MockupConfig): string {
  const garmentColor = brief.colorways.garment_color.toLowerCase();
  const isHeavyweight = brief.mockup_brief.primary.toLowerCase().includes("comfort colors");

  // Find matching template
  for (const [id, tmpl] of Object.entries(config.templates)) {
    if (tmpl.view === viewType || (viewType === "front_on_model" && tmpl.view === "front")) {
      if (garmentColor.includes(tmpl.color.toLowerCase().split(" ")[0])) {
        return id;
      }
    }
  }

  // Fallback to first available template for the view
  for (const [id, tmpl] of Object.entries(config.templates)) {
    if (tmpl.view === viewType || (viewType === "front_on_model" && tmpl.view === "front")) {
      return id;
    }
  }

  return Object.keys(config.templates)[0];
}

/** Main: generate mockups for all briefs */
export async function generateMockups(
  briefs: DesignBrief[],
  week: string,
  dropDir: string
): Promise<MockupManifest> {
  const config = loadConfig<MockupConfig>(path.join(process.cwd(), "config", "mockup_config.json"));
  const adapter = getAdapter(config);
  const results: MockupResult[] = [];

  for (const brief of briefs) {
    const slug = slugify(brief.phrase);

    for (const viewType of config.per_design_variants) {
      const templateId = selectTemplate(brief, viewType, config);
      const viewLabel = viewType === "front_on_model" ? "front" : viewType;
      const filename = makeFilename(week, brief.concept_id, slug, brief.variant_label, viewLabel);
      const outDir = path.join(
        dropDir,
        "ASSETS",
        "MOCKUPS",
        slug,
        brief.variant_label
      );
      const outputPath = path.join(outDir, filename);

      // Look for design image in ASSETS/DESIGNS
      const designPath = path.join(dropDir, "ASSETS", "DESIGNS", `${brief.concept_id}_${brief.variant_label}.png`);

      try {
        const result = await adapter.generate(brief, designPath, templateId, outputPath);
        results.push(result);
        log(dropDir, `Mockup generated: ${filename}`);
      } catch (err: any) {
        results.push({
          concept_id: brief.concept_id,
          design_slug: slug,
          variant_label: brief.variant_label,
          mockup_type: viewType === "flatlay" ? "flatlay" : "front_on_model",
          blank: templateId,
          color: brief.colorways.garment_color,
          file_path: outputPath,
          export_size: "2000x2000",
          status: "placeholder",
        });
        log(dropDir, `Mockup generation failed for ${brief.concept_id}: ${err.message}`, "WARN");
      }
    }
  }

  const manifest: MockupManifest = {
    week,
    generated_at: new Date().toISOString(),
    mockups: results,
  };

  writeJson(path.join(dropDir, "ASSETS", "MOCKUPS", "mockup_manifest.json"), manifest);
  return manifest;
}
