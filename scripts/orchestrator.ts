/**
 * orchestrator.ts — Weekly Drop Orchestrator
 * State machine that runs the full ideation → publish → postmortem pipeline
 */

import * as fs from "fs";
import * as path from "path";
import {
  DesignConcept,
  ScoredConcept,
  DesignBrief,
  ProductListing,
  MarketingPack,
  CoworkInput,
  WeeklyDropState,
} from "./types";
import {
  createDropDir,
  getCurrentWeek,
  writeJson,
  readJson,
  fileExists,
  log,
  slugify,
  loadConfig,
} from "./utils";
import { normalizeCoworkInput, filterAndScore, selectFinalists } from "./scoring";
import { generateBriefs } from "./brief_factory";
import { generateMockups } from "./mockup_generator";
import { ShopifyPublisher } from "./shopify_publisher";
import { generateEmailSequence, scheduleKlaviyoSequence } from "./email_automations";
import { runAnalyticsIngest, generateTrackingTemplate } from "./analytics_ingest";

/** Generate the 3 cowork prompts and write them to the drop directory */
function generateCoworkPrompts(week: string, dropDir: string): void {
  const promptsDir = path.join(process.cwd(), "prompts");
  const coworkDir = path.join(dropDir, "COWORK");
  fs.mkdirSync(coworkDir, { recursive: true });

  const promptFiles = [
    ["cowork_chatgpt_idea_miner.txt", "01_chatgpt_prompt.txt"],
    ["cowork_gemini_angle_miner.txt", "02_gemini_prompt.txt"],
    ["cowork_design_arena_visual_miner.txt", "03_design_arena_prompt.txt"],
  ];

  for (const [src, dest] of promptFiles) {
    const srcPath = path.join(promptsDir, src);
    const destPath = path.join(coworkDir, dest);
    if (fileExists(srcPath)) {
      let content = fs.readFileSync(srcPath, "utf-8");
      content = `# Generated for Drop Week: ${week}\n# Paste this into the respective AI tool and save response in COWORK/inputs/\n\n` + content;
      fs.writeFileSync(destPath, content);
    }
  }

  log(dropDir, `Cowork prompts written to ${coworkDir}`);
}

/** Parse cowork response files from COWORK/inputs/ */
function parseCoworkResponses(dropDir: string, week: string): DesignConcept[] {
  const inputsDir = path.join(dropDir, "COWORK", "inputs");
  const concepts: DesignConcept[] = [];

  const responseFiles = [
    { file: "chatgpt_response.txt", source: "chatgpt" },
    { file: "gemini_response.txt", source: "gemini" },
    { file: "design_arena_response.txt", source: "design_arena" },
  ];

  for (const { file, source } of responseFiles) {
    const filePath = path.join(inputsDir, file);
    if (!fileExists(filePath)) {
      log(dropDir, `Cowork input not found: ${file} — skipping`, "WARN");
      continue;
    }

    const raw = fs.readFileSync(filePath, "utf-8").trim();
    let parsed: CoworkInput[] = [];

    // Extract JSON array from response (may have leading/trailing text)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log(dropDir, `Could not parse JSON from ${file} — invalid format`, "WARN");
      continue;
    }

    try {
      parsed = JSON.parse(jsonMatch[0]) as CoworkInput[];
    } catch {
      log(dropDir, `JSON parse error in ${file}`, "ERROR");
      continue;
    }

    // Schema validation — reject malformed entries
    const valid = parsed.filter((c) => {
      const required = ["CONCEPT_ID", "PHRASE", "ANGLE", "VISUAL_HOOK", "TARGET", "VARIANTS", "NOTES"];
      const missing = required.filter((f) => !(f in c));
      if (missing.length > 0) {
        log(dropDir, `Rejected ${c.CONCEPT_ID ?? "unknown"} from ${source}: missing fields ${missing.join(", ")}`, "WARN");
        return false;
      }
      return true;
    });

    for (const raw_concept of valid) {
      concepts.push(normalizeCoworkInput(raw_concept, source, week));
    }
    log(dropDir, `Parsed ${valid.length} valid concepts from ${source}`);
  }

  return concepts;
}

/** Generate a simple Shopify-ready listing from a brief */
function generateListing(brief: DesignBrief, week: string): ProductListing {
  const slug = slugify(brief.phrase);
  const listingId = `${brief.asset_id}-LISTING`;
  const handle = `teejano-${slug}-${week.replace("-", "").toLowerCase()}`;
  const title = `${brief.phrase} | Texas Humor Tee — Teejano`;

  const garmentDesc = brief.colorways.garment_color === "Pepper" || brief.colorways.garment_color === "Ivory"
    ? "Comfort Colors heavyweight tee"
    : "Bella+Canvas unisex tee";

  const description = `<p><strong>${brief.phrase}</strong> — Because Texas doesn't need an explanation.</p>
<p>This isn't your average "Texas pride" shirt. This is the shirt you wear when you want people to actually get it.</p>
<p>Printed on a ${garmentDesc}. Soft. Structured. Built to wear.</p>
<p><strong>Fit:</strong> Unisex. True to size. Order your normal size.</p>`;

  return {
    listing_id: listingId,
    concept_id: brief.concept_id,
    asset_id: brief.asset_id,
    created_at: new Date().toISOString(),
    status: "draft",
    title_seo: title.slice(0, 70),
    description_html: description,
    meta_description: `${brief.phrase} — Teejano Texas humor tee. Bold. Clean. Made for Texans. ${brief.colorways.garment_color} tee.`.slice(0, 155),
    collections: ["General Texas Humor", "Weekly Drops"],
    tags: [
      "texas-humor",
      "texas-tee",
      "teejano",
      `drop-${week.toLowerCase()}`,
      brief.colorways.garment_color.toLowerCase().replace(/\s+/g, "-"),
      brief.print_specs.placement.replace("_", "-"),
      ...brief.fonts.map((f) => f.toLowerCase().replace(/\s+/g, "-")),
    ].filter(Boolean),
    handle,
    price: 29.99,
    compare_at_price: 36.99,
    mockup_urls: [],
    alt_texts: {
      primary: `${brief.phrase} — Teejano Texas humor tee on ${brief.colorways.garment_color} ${garmentDesc}`,
      secondary: `${brief.phrase} — Teejano tee flatlay detail`,
    },
    launch_type: "drop",
    launch_date: undefined,
  };
}

/** Generate APPROVAL.md for human review gate */
function generateApprovalDoc(
  week: string,
  finalists: ScoredConcept[],
  dropDir: string
): void {
  const lines = [
    `# APPROVAL CHECKLIST — ${week}`,
    ``,
    `> Review all items below. When ready, add \`APPROVED=true\` on the first line and save.`,
    `> Run orchestrator again with --mode publish to proceed.`,
    ``,
    `APPROVED=false`,
    ``,
    `---`,
    ``,
    `## Finalists (${finalists.length} concepts)`,
    ``,
    ...finalists.map((c, i) =>
      `### ${i + 1}. ${c.phrase_primary} (Score: ${c.total_score}/100)\n- [ ] Phrase approved\n- [ ] No copyright risk\n- [ ] Ready for design\n- Angle: ${c.angle}\n- Sell thesis: ${c.sell_thesis}\n`
    ),
    `---`,
    ``,
    `## Pre-publish Checklist`,
    `- [ ] All mockups generated`,
    `- [ ] Shopify listings reviewed in draft mode`,
    `- [ ] Email sequence approved`,
    `- [ ] Social copy reviewed`,
    `- [ ] No trademark violations`,
    ``,
  ];

  fs.writeFileSync(path.join(dropDir, "APPROVAL.md"), lines.join("\n"));
}

/** Check if human has approved the drop */
function isApproved(dropDir: string): boolean {
  const approvalPath = path.join(dropDir, "APPROVAL.md");
  if (!fileExists(approvalPath)) return false;
  const content = fs.readFileSync(approvalPath, "utf-8");
  return content.includes("APPROVED=true");
}

/** Generate the 05_MOCKUP_SHOTLIST.md */
function generateShotlist(briefs: DesignBrief[], dropDir: string): void {
  const lines = [
    `# MOCKUP SHOT LIST`,
    ``,
    `Use this as your production checklist for mockup generation.`,
    ``,
    ...briefs.map((b) =>
      `## ${b.concept_id} — ${b.variant_label}: "${b.phrase}"\n- Blank: ${b.mockup_brief.primary}\n- Secondary: ${b.mockup_brief.secondary}\n- Colors: ${b.colorways.garment_color} / Ink: ${b.colorways.ink_colors.map((i) => i.name).join(", ")}\n- Placement: ${b.print_specs.placement}\n- [ ] Front on model\n- [ ] Flatlay\n`
    ),
  ];
  fs.writeFileSync(path.join(dropDir, "05_MOCKUP_SHOTLIST.md"), lines.join("\n"));
}

/** Main orchestration function */
export async function runWeeklyDrop(week: string, mode: "draft" | "publish"): Promise<void> {
  console.log(`\n🤠 TEEJANO AGENCY — Weekly Drop Runner`);
  console.log(`   Week: ${week} | Mode: ${mode}\n`);

  const dropDir = createDropDir(week);
  log(dropDir, `Starting weekly drop run — week: ${week}, mode: ${mode}`);

  // === PHASE 1: COWORK PROMPTS ===
  log(dropDir, "Phase 1: Generating cowork prompts");
  generateCoworkPrompts(week, dropDir);

  // Check if cowork inputs are present
  const inputsDir = path.join(dropDir, "COWORK", "inputs");
  const hasInputs = ["chatgpt_response.txt", "gemini_response.txt", "design_arena_response.txt"]
    .some((f) => fileExists(path.join(inputsDir, f)));

  if (!hasInputs) {
    console.log(`\n📋 COWORK CHECKPOINT`);
    console.log(`   Prompts are ready in: drops/${week}/COWORK/`);
    console.log(`   Steps:`);
    console.log(`   1. Paste each prompt into ChatGPT, Gemini, and Design Arena`);
    console.log(`   2. Save responses to: drops/${week}/COWORK/inputs/`);
    console.log(`      - chatgpt_response.txt`);
    console.log(`      - gemini_response.txt`);
    console.log(`      - design_arena_response.txt`);
    console.log(`   3. Re-run: npx ts-node scripts/run_weekly_drop.ts --week ${week} --mode ${mode}`);
    log(dropDir, "Paused at cowork checkpoint — awaiting input files");
    return;
  }

  // === PHASE 2: PARSE + SCORE + SELECT ===
  log(dropDir, "Phase 2: Parsing cowork outputs, scoring, selecting finalists");
  const rawConcepts = parseCoworkResponses(dropDir, week);
  const scored = filterAndScore(rawConcepts);
  const finalists = selectFinalists(scored, 12);

  writeJson(path.join(dropDir, "01_FINALISTS.md.json"), finalists);

  // Write finalists markdown
  const finalistsMd = [
    `# FINALISTS — ${week}`,
    ``,
    `Total candidates: ${rawConcepts.length} | Finalists: ${finalists.length}`,
    ``,
    ...finalists.map((c, i) =>
      `## ${i + 1}. "${c.phrase_primary}" — Score: ${c.total_score}/100\n- Angle: ${c.angle}\n- Target: ${c.audience}\n- Sell thesis: ${c.sell_thesis}\n- Variant A: ${c.variants[0]?.phrase}\n- Variant B: ${c.variants[1]?.phrase}\n`
    ),
  ].join("\n");
  fs.writeFileSync(path.join(dropDir, "01_FINALISTS.md"), finalistsMd);

  log(dropDir, `Finalists selected: ${finalists.length}`);

  // === PHASE 3: DESIGN BRIEFS ===
  log(dropDir, "Phase 3: Generating design briefs");
  const briefs = generateBriefs(finalists, week, dropDir);
  generateShotlist(briefs, dropDir);
  log(dropDir, `Design briefs generated: ${briefs.length}`);

  // === PHASE 4: LISTINGS ===
  log(dropDir, "Phase 4: Generating Shopify listings");
  const listings: ProductListing[] = briefs.map((b) => generateListing(b, week));
  writeJson(path.join(dropDir, "03_LISTINGS", "_all_listings.json"), listings);

  for (const listing of listings) {
    const slug = slugify(listing.handle);
    writeJson(path.join(dropDir, "03_LISTINGS", `${listing.listing_id}.json`), listing);
  }
  log(dropDir, `Listings generated: ${listings.length}`);

  // === PHASE 5: MARKETING PACKS ===
  log(dropDir, "Phase 5: Generating marketing packs");
  const topPhrases = finalists.slice(0, 5).map((c) => c.phrase_primary);
  generateEmailSequence(week, `Teejano Drop ${week}`, topPhrases, "https://teejano.com", dropDir);

  // Write social/SMS copy pack
  const marketingDir = path.join(dropDir, "04_MARKETING");
  fs.mkdirSync(marketingDir, { recursive: true });
  const marketingPack = {
    week,
    top_phrases: topPhrases,
    instagram_drop_caption: `New Teejano drop is LIVE.\n\n${topPhrases.slice(0, 2).join(" • ")}\n\nTexas-made. Bold by default.\nLink in bio.\n\n#TexasHumor #TejanosOfTexas #TexasApparel #MadeInTexas #TexasTee #TexasPride #TexasBold #TexasStreetWear #TeejanoStyle #TexasDrop`,
    tiktok_script: `[HOOK] You see this shirt?\n[CONTEXT] This is not a tourist tee. This is Teejano.\n[REVEAL] "${topPhrases[0]}" — drop is live right now.\n[CTA] Link in bio. Limited run.`,
    sms_drop_live: `Teejano: New drop is LIVE. "${topPhrases[0]}" + more. Shop: https://teejano.com/collections/weekly-drops Reply STOP to opt out.`,
    sms_last_call: `Teejano: Last chance — drop closes tonight. Don't sleep on it. https://teejano.com/collections/weekly-drops Reply STOP to opt out.`,
    influencer_dm: `Hey! Big fan of your content. We're Teejano — Texas-made apparel with some edge. Think you'd vibe with our latest drop. Would love to send you a tee if you're down. DM back or grab it at teejano.com`,
  };
  writeJson(path.join(marketingDir, "marketing_pack.json"), marketingPack);
  log(dropDir, "Marketing pack generated");

  // === PHASE 6: MOCKUPS ===
  log(dropDir, "Phase 6: Generating mockups");
  const mockupManifest = await generateMockups(briefs, week, dropDir);
  log(dropDir, `Mockups generated: ${mockupManifest.mockups.length}`);

  // === PHASE 7: APPROVAL GATE ===
  generateApprovalDoc(week, finalists, dropDir);
  generateTrackingTemplate(week, listings, dropDir);

  if (mode === "draft") {
    log(dropDir, "Mode=draft — stopping before publish. Review APPROVAL.md to proceed.");
    console.log(`\n✅ DRAFT COMPLETE`);
    console.log(`   Drop folder: drops/${week}/`);
    console.log(`   Next: Review APPROVAL.md, set APPROVED=true, then run with --mode publish`);
    return;
  }

  if (!isApproved(dropDir)) {
    log(dropDir, "Mode=publish but APPROVAL.md not approved — halting", "WARN");
    console.log(`\n⚠️  APPROVAL REQUIRED`);
    console.log(`   Edit drops/${week}/APPROVAL.md → set APPROVED=true → re-run with --mode publish`);
    return;
  }

  // === PHASE 8: PUBLISH TO SHOPIFY ===
  log(dropDir, "Phase 8: Publishing to Shopify");
  const publisher = new ShopifyPublisher();
  const publishLogs = await publisher.publishDrop(listings, mockupManifest, dropDir);
  const successCount = publishLogs.filter((l) => l.status === "success").length;
  log(dropDir, `Shopify publish complete: ${successCount}/${publishLogs.length} succeeded`);

  // === PHASE 9: SCHEDULE EMAILS ===
  log(dropDir, "Phase 9: Scheduling email sequence");
  await scheduleKlaviyoSequence(week, dropDir);

  console.log(`\n🚀 DROP ${week} COMPLETE`);
  console.log(`   Published: ${successCount} products`);
  console.log(`   Logs: drops/${week}/LOGS/run.log`);
  console.log(`   Publish log: drops/${week}/PUBLISH/publish_log.json`);
}

/** Run postmortem for a completed drop */
export async function runPostmortem(week: string): Promise<void> {
  console.log(`\n📊 TEEJANO AGENCY — Postmortem Runner`);
  console.log(`   Week: ${week}\n`);

  const dropDir = path.join(process.cwd(), "drops", week);
  if (!fileExists(dropDir)) {
    console.error(`Drop folder not found: ${dropDir}`);
    process.exit(1);
  }

  await runAnalyticsIngest(week, dropDir);
  console.log(`\n✅ Postmortem complete — see drops/${week}/POSTMORTEM.md`);
}
