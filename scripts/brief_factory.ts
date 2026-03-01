/**
 * brief_factory.ts — Design Brief Factory
 * Converts scored/approved concepts into production-ready design briefs (2 variants each)
 */

import * as fs from "fs";
import * as path from "path";
import { ScoredConcept, DesignBrief, AssetStatus } from "./types";
import { slugify, writeJson, makeFilename } from "./utils";

interface ProductDefaults {
  blanks: Record<string, {
    name: string;
    default_colors: string[];
    available_colors: Array<{ name: string; hex: string }>;
  }>;
  print_area: Record<string, { width_inches: number; height_inches: number }>;
}

const FONT_MAP: Record<string, string[]> = {
  texas_pride_deadpan: ["Bold Condensed Sans", "Heavy Block Serif"],
  gym_cowboy_crossover: ["Extra Bold Condensed", "Western Slab"],
  tejano_cultural: ["Bold Sans", "Script Accent (minimal)"],
  outsider_vs_texan: ["Bold Condensed Sans", "None"],
  self_deprecating_texas: ["Heavy Display", "None"],
  weather_geography: ["Bold Sans", "Condensed Secondary"],
  food_bbq: ["Western Slab", "Bold Sans"],
  sports_generic: ["Extra Bold Condensed", "None"],
};

const LAYOUT_MAP: Record<string, string> = {
  texas_pride_deadpan: "stacked",
  gym_cowboy_crossover: "badge",
  tejano_cultural: "arched",
  outsider_vs_texan: "single_line",
  self_deprecating_texas: "condensed_block",
  weather_geography: "stacked",
  food_bbq: "badge",
  sports_generic: "single_line",
};

const COLOR_PALETTES = [
  { garment: "Black", garment_hex: "#000000", inks: [{ name: "White", hex: "#FFFFFF" }], spots: 1 },
  { garment: "Black", garment_hex: "#000000", inks: [{ name: "White", hex: "#FFFFFF" }, { name: "Red", hex: "#C8102E" }], spots: 2 },
  { garment: "White", garment_hex: "#FFFFFF", inks: [{ name: "Black", hex: "#000000" }], spots: 1 },
  { garment: "Athletic Heather", garment_hex: "#B8B8B8", inks: [{ name: "Black", hex: "#000000" }, { name: "Red", hex: "#C8102E" }], spots: 2 },
  { garment: "Pepper", garment_hex: "#3A3A3A", inks: [{ name: "Ivory", hex: "#F5F0E8" }], spots: 1 },
  { garment: "Ivory", garment_hex: "#F5F0E8", inks: [{ name: "Dark Brown", hex: "#2C1A08" }, { name: "Rust", hex: "#8B3A2A" }], spots: 2 },
  { garment: "Butter", garment_hex: "#E8D98C", inks: [{ name: "Black", hex: "#000000" }], spots: 1 },
  { garment: "Washed Moss", garment_hex: "#6B7C5C", inks: [{ name: "Cream", hex: "#F5F0E8" }], spots: 1 },
];

/** Select appropriate color palette for a concept */
function selectPalette(index: number) {
  return COLOR_PALETTES[index % COLOR_PALETTES.length];
}

/** Generate one design brief variant */
function makeVariant(
  concept: ScoredConcept,
  variantIndex: number,
  week: string
): DesignBrief {
  const variantLabel = variantIndex === 0 ? "VA" : "VB";
  const assetId = `${concept.concept_id}-${variantLabel}`;
  const conceptVariant = concept.variants[variantIndex];
  const phrase = conceptVariant?.phrase || concept.phrase_primary;
  const angle = concept.angle || "texas_pride_deadpan";

  const fonts = FONT_MAP[angle] ?? ["Bold Condensed Sans", "None"];
  const layoutType = LAYOUT_MAP[angle] ?? "stacked";
  const palette = selectPalette(variantIndex * 2 + (concept.total_score % 3));
  const blankName = variantIndex === 0 ? "Bella+Canvas 3001" : "Comfort Colors 1717";

  const placementOptions: Record<string, { width_inches: number; height_inches: number }> = {
    front_center: { width_inches: 12, height_inches: 14 },
    pocket_left: { width_inches: 4, height_inches: 4 },
    chest_center: { width_inches: 5, height_inches: 5 },
  };
  const placement = phrase.split(" ").length <= 3 ? "chest_center" : "front_center";
  const printArea = placementOptions[placement];

  const iconNotes = concept.imagery_notes
    ? `${concept.imagery_notes}. Keep to 1–2 simple elements max. Bold outline only.`
    : "Typography Only — no illustration";

  return {
    asset_id: assetId,
    concept_id: concept.concept_id,
    week,
    created_at: new Date().toISOString(),
    status: "brief_ready",
    designer: "ai",
    variant_label: variantLabel,
    phrase,
    layout_map: {
      layout_type: layoutType as DesignBrief["layout_map"]["layout_type"],
      font_primary: fonts[0],
      font_secondary: fonts[1] !== "None" ? fonts[1] : undefined,
      hierarchy: variantIndex === 0
        ? "Full phrase as single dominant block"
        : "Line 1 large / Line 2 medium accent",
    },
    fonts,
    colorways: {
      garment_color: palette.garment,
      garment_hex: palette.garment_hex,
      ink_colors: palette.inks,
      spot_count: palette.spots,
    },
    print_specs: {
      placement,
      width_inches: printArea.width_inches,
      height_inches: printArea.height_inches,
      front_back: "front_only",
      min_stroke_pt: 1.5,
      no_gradients: true,
      spot_colors: palette.spots,
    },
    icon_notes: iconNotes,
    mockup_brief: {
      primary: `${blankName} ${palette.garment} — front on model (male or female)`,
      secondary: `Flatlay on natural surface (wood, concrete, or denim)`,
    },
    notes: concept.sell_thesis,
  };
}

/** Generate markdown brief file */
function writeBriefMarkdown(brief: DesignBrief, dropDir: string): void {
  const templatePath = path.join(process.cwd(), "templates", "briefs", "design_brief.md");
  let template = fs.readFileSync(templatePath, "utf-8");

  const replacements: Record<string, string> = {
    week: brief.week,
    concept_id: brief.concept_id,
    category: "general_texas_humor",
    humor_angle: brief.layout_map.layout_type,
    phrase_primary: brief.phrase,
    target: "Texas 20–50",
    hook: brief.icon_notes,
    sell_thesis: brief.notes ?? "",
    variant_a_phrase: brief.phrase,
    variant_a_garment: brief.layout_map.font_primary,
    variant_a_color: brief.colorways.garment_color,
    variant_a_placement: brief.print_specs.placement,
    variant_a_layout: brief.layout_map.layout_type,
    variant_a_font_primary: brief.layout_map.font_primary,
    variant_a_font_secondary: brief.layout_map.font_secondary ?? "—",
    variant_a_hierarchy: brief.layout_map.hierarchy,
    variant_a_garment_color: brief.colorways.garment_color,
    variant_a_garment_hex: brief.colorways.garment_hex,
    variant_a_ink_1: brief.colorways.ink_colors[0]?.name ?? "White",
    variant_a_ink_1_hex: brief.colorways.ink_colors[0]?.hex ?? "#FFFFFF",
    variant_a_ink_2: brief.colorways.ink_colors[1]?.name ?? "—",
    variant_a_ink_2_hex: brief.colorways.ink_colors[1]?.hex ?? "—",
    variant_a_spot_count: String(brief.colorways.spot_count),
    variant_a_print_area: `${brief.print_specs.placement} ${brief.print_specs.width_inches}"×${brief.print_specs.height_inches}"`,
    variant_a_front_back: brief.print_specs.front_back,
    variant_a_icon_notes: brief.icon_notes,
    variant_a_mockup_primary: brief.mockup_brief.primary,
    variant_a_mockup_secondary: brief.mockup_brief.secondary,
    // Variant B mirrors for now (will differ after human input)
    variant_b_phrase: brief.phrase,
    variant_b_garment: brief.layout_map.font_primary,
    variant_b_color: brief.colorways.garment_color,
    variant_b_placement: brief.print_specs.placement,
    variant_b_layout: brief.layout_map.layout_type,
    variant_b_font_primary: brief.layout_map.font_primary,
    variant_b_font_secondary: brief.layout_map.font_secondary ?? "—",
    variant_b_hierarchy: brief.layout_map.hierarchy,
    variant_b_garment_color: brief.colorways.garment_color,
    variant_b_garment_hex: brief.colorways.garment_hex,
    variant_b_ink_1: brief.colorways.ink_colors[0]?.name ?? "White",
    variant_b_ink_1_hex: brief.colorways.ink_colors[0]?.hex ?? "#FFFFFF",
    variant_b_ink_2: brief.colorways.ink_colors[1]?.name ?? "—",
    variant_b_ink_2_hex: brief.colorways.ink_colors[1]?.hex ?? "—",
    variant_b_spot_count: String(brief.colorways.spot_count),
    variant_b_print_area: `${brief.print_specs.placement} ${brief.print_specs.width_inches}"×${brief.print_specs.height_inches}"`,
    variant_b_front_back: brief.print_specs.front_back,
    variant_b_icon_notes: brief.icon_notes,
    variant_b_mockup_primary: brief.mockup_brief.primary,
    variant_b_mockup_secondary: brief.mockup_brief.secondary,
    designer_notes: brief.notes ?? "",
    risk_flags: "None detected",
    score: "—",
  };

  for (const [key, val] of Object.entries(replacements)) {
    template = template.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }

  const slug = slugify(brief.phrase);
  const filename = `${brief.concept_id}_${brief.variant_label}_${slug}.md`;
  const outPath = path.join(dropDir, "02_DESIGN_BRIEFS", filename);
  fs.writeFileSync(outPath, template, "utf-8");
}

/** Main: generate all briefs for a list of finalists */
export function generateBriefs(finalists: ScoredConcept[], week: string, dropDir: string): DesignBrief[] {
  const allBriefs: DesignBrief[] = [];

  for (const concept of finalists) {
    for (let v = 0; v < 2; v++) {
      const brief = makeVariant(concept, v, week);
      allBriefs.push(brief);
      writeBriefMarkdown(brief, dropDir);
    }
  }

  writeJson(path.join(dropDir, "02_DESIGN_BRIEFS", "_all_briefs.json"), allBriefs);
  return allBriefs;
}
