/**
 * api.ts — REST API Routes
 * All pipeline operations exposed as HTTP endpoints.
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

import { getCurrentWeek, createDropDir, writeJson, readJson, fileExists, loadConfig } from "../../scripts/utils";
import { normalizeCoworkInput, filterAndScore, selectFinalists } from "../../scripts/scoring";
import { generateBriefs } from "../../scripts/brief_factory";
import { generateMockups } from "../../scripts/mockup_generator";
import { generateEmailSequence } from "../../scripts/email_automations";
import { generateTrackingTemplate } from "../../scripts/analytics_ingest";
import { CoworkInput, ScoredConcept } from "../../scripts/types";
import { callAI } from "../services/ai";

export const router = Router();

// In-memory pipeline status per week (resets on server restart; log file is persistent)
const pipelineStatus: Record<string, { phase: string; running: boolean; error?: string }> = {};

// SSE clients for real-time log streaming
const sseClients: Record<string, Response[]> = {};

function broadcastLog(week: string, message: string, level = "INFO"): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  const clients = sseClients[week] ?? [];
  for (const client of clients) {
    client.write(`data: ${JSON.stringify({ line, level })}\n\n`);
  }
}

function appendLog(dropDir: string, message: string, level = "INFO"): void {
  const logFile = path.join(dropDir, "LOGS", "run.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  fs.appendFileSync(logFile, line);
}

// ─────────────────────────────────────────────
// DROPS — List & Status
// ─────────────────────────────────────────────

/** GET /api/drops — list all drop weeks */
router.get("/drops", (_req, res) => {
  const dropsDir = path.join(process.cwd(), "drops");
  if (!fs.existsSync(dropsDir)) return res.json({ drops: [] });

  const weeks = fs
    .readdirSync(dropsDir)
    .filter((d) => /^\d{4}-W\d{2}$/.test(d))
    .sort()
    .reverse()
    .map((week) => {
      const dropDir = path.join(dropsDir, week);
      const approvalPath = path.join(dropDir, "APPROVAL.md");
      const logPath = path.join(dropDir, "LOGS", "run.log");
      const finalistsPath = path.join(dropDir, "01_FINALISTS.md");
      const postmortemPath = path.join(dropDir, "POSTMORTEM.md");

      let approved = false;
      if (fileExists(approvalPath)) {
        approved = fs.readFileSync(approvalPath, "utf-8").includes("APPROVED=true");
      }

      // Count finalists from JSON if present
      const finalistJson = path.join(dropDir, "01_FINALISTS.md.json");
      const finalistCount = fileExists(finalistJson)
        ? (JSON.parse(fs.readFileSync(finalistJson, "utf-8")) as unknown[]).length
        : 0;

      const coworkInputs = path.join(dropDir, "COWORK", "inputs");
      const inputFiles = fileExists(coworkInputs) ? fs.readdirSync(coworkInputs) : [];

      return {
        week,
        approved,
        has_finalists: fileExists(finalistsPath),
        finalist_count: finalistCount,
        has_postmortem: fileExists(postmortemPath),
        cowork_inputs_submitted: inputFiles.length,
        has_log: fileExists(logPath),
        pipeline_phase: pipelineStatus[week]?.phase ?? (fileExists(finalistsPath) ? "finalists_ready" : "awaiting_cowork"),
      };
    });

  res.json({ drops: weeks, current_week: getCurrentWeek() });
});

/** GET /api/drops/:week — get full drop status */
router.get("/drops/:week", (req, res) => {
  const { week } = req.params;
  const dropDir = path.join(process.cwd(), "drops", week);

  if (!fileExists(dropDir)) {
    return res.status(404).json({ error: "Drop not found" });
  }

  const approvalPath = path.join(dropDir, "APPROVAL.md");
  const finalistJson = path.join(dropDir, "01_FINALISTS.md.json");
  const listingsDir = path.join(dropDir, "03_LISTINGS");
  const marketingPath = path.join(dropDir, "04_MARKETING", "marketing_pack.json");
  const publishLogPath = path.join(dropDir, "PUBLISH", "publish_log.json");
  const mockupManifestPath = path.join(dropDir, "ASSETS", "MOCKUPS", "mockup_manifest.json");

  const approved = fileExists(approvalPath) && fs.readFileSync(approvalPath, "utf-8").includes("APPROVED=true");
  const finalists = fileExists(finalistJson) ? readJson<ScoredConcept[]>(finalistJson) : [];
  const listings = fileExists(path.join(listingsDir, "_all_listings.json"))
    ? readJson<unknown[]>(path.join(listingsDir, "_all_listings.json"))
    : [];
  const marketing = fileExists(marketingPath) ? readJson<unknown>(marketingPath) : null;
  const publishLog = fileExists(publishLogPath) ? readJson<unknown[]>(publishLogPath) : [];
  const mockupManifest = fileExists(mockupManifestPath) ? readJson<unknown>(mockupManifestPath) : null;

  const coworkDir = path.join(dropDir, "COWORK", "inputs");
  const coworkInputs: Record<string, boolean> = {
    chatgpt: fileExists(path.join(coworkDir, "chatgpt_response.txt")),
    gemini: fileExists(path.join(coworkDir, "gemini_response.txt")),
    design_arena: fileExists(path.join(coworkDir, "design_arena_response.txt")),
  };

  // Read prompts
  const promptsDir = path.join(dropDir, "COWORK");
  const prompts: Record<string, string> = {};
  for (const [key, file] of [
    ["chatgpt", "01_chatgpt_prompt.txt"],
    ["gemini", "02_gemini_prompt.txt"],
    ["design_arena", "03_design_arena_prompt.txt"],
  ] as [string, string][]) {
    const p = path.join(promptsDir, file);
    if (fileExists(p)) prompts[key] = fs.readFileSync(p, "utf-8");
  }

  res.json({
    week,
    approved,
    pipeline_phase: pipelineStatus[week]?.phase ?? (finalists.length > 0 ? "finalists_ready" : "awaiting_cowork"),
    pipeline_running: pipelineStatus[week]?.running ?? false,
    cowork_inputs: coworkInputs,
    prompts,
    finalist_count: finalists.length,
    finalists,
    listing_count: listings.length,
    marketing,
    publish_log: publishLog,
    mockup_manifest: mockupManifest,
  });
});

// ─────────────────────────────────────────────
// PIPELINE — Start / Run phases
// ─────────────────────────────────────────────

/** POST /api/pipeline/start — create a new drop, generate cowork prompts */
router.post("/pipeline/start", async (req, res) => {
  const { week = getCurrentWeek() } = req.body as { week?: string };

  if (pipelineStatus[week]?.running) {
    return res.status(409).json({ error: "Pipeline already running for this week" });
  }

  const dropDir = createDropDir(week);
  pipelineStatus[week] = { phase: "generating_prompts", running: true };

  try {
    // Copy cowork prompts to drop directory
    const srcDir = path.join(process.cwd(), "prompts");
    const destDir = path.join(dropDir, "COWORK");
    fs.mkdirSync(path.join(destDir, "inputs"), { recursive: true });

    const promptMap: [string, string][] = [
      ["cowork_chatgpt_idea_miner.txt", "01_chatgpt_prompt.txt"],
      ["cowork_gemini_angle_miner.txt", "02_gemini_prompt.txt"],
      ["cowork_design_arena_visual_miner.txt", "03_design_arena_prompt.txt"],
    ];

    const prompts: Record<string, string> = {};
    for (const [src, dest] of promptMap) {
      const srcPath = path.join(srcDir, src);
      const destPath = path.join(destDir, dest);
      if (fileExists(srcPath)) {
        let content = fs.readFileSync(srcPath, "utf-8");
        content = `# Generated for Drop Week: ${week}\n\n` + content;
        fs.writeFileSync(destPath, content);
        prompts[dest] = content;
      }
    }

    appendLog(dropDir, `Drop initialized for week ${week}`);
    pipelineStatus[week] = { phase: "awaiting_cowork", running: false };

    res.json({ success: true, week, drop_dir: `drops/${week}`, prompts });
  } catch (err: any) {
    pipelineStatus[week] = { phase: "error", running: false, error: err.message };
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/pipeline/score — score + select finalists (after cowork inputs submitted) */
router.post("/pipeline/score", async (req, res) => {
  const { week } = req.body as { week: string };
  if (!week) return res.status(400).json({ error: "week required" });

  const dropDir = path.join(process.cwd(), "drops", week);
  if (!fileExists(dropDir)) return res.status(404).json({ error: "Drop not found" });

  pipelineStatus[week] = { phase: "scoring", running: true };

  try {
    const inputsDir = path.join(dropDir, "COWORK", "inputs");
    const rawConcepts: ReturnType<typeof normalizeCoworkInput>[] = [];

    const sources = [
      { file: "chatgpt_response.txt", source: "chatgpt" },
      { file: "gemini_response.txt", source: "gemini" },
      { file: "design_arena_response.txt", source: "design_arena" },
    ];

    for (const { file, source } of sources) {
      const filePath = path.join(inputsDir, file);
      if (!fileExists(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[0]) as CoworkInput[];
        for (const c of parsed) {
          const required = ["CONCEPT_ID", "PHRASE", "ANGLE", "VISUAL_HOOK", "TARGET", "VARIANTS", "NOTES"];
          if (required.every((f) => f in c)) {
            rawConcepts.push(normalizeCoworkInput(c, source, week));
          }
        }
      } catch {}
    }

    const scored = filterAndScore(rawConcepts);
    const finalists = selectFinalists(scored, 12);

    writeJson(path.join(dropDir, "01_FINALISTS.md.json"), finalists);

    // Write finalists markdown
    const md = [
      `# FINALISTS — ${week}\n`,
      `Total candidates: ${rawConcepts.length} | Finalists: ${finalists.length}\n`,
      ...finalists.map((c, i) =>
        `## ${i + 1}. "${c.phrase_primary}" — Score: ${c.total_score}/100\n- Angle: ${c.angle}\n- Target: ${c.audience}\n- Sell thesis: ${c.sell_thesis}\n`
      ),
    ].join("\n");
    fs.writeFileSync(path.join(dropDir, "01_FINALISTS.md"), md);

    appendLog(dropDir, `Scored ${rawConcepts.length} candidates → ${finalists.length} finalists selected`);
    pipelineStatus[week] = { phase: "finalists_ready", running: false };

    res.json({ success: true, week, candidate_count: rawConcepts.length, finalist_count: finalists.length, finalists });
  } catch (err: any) {
    pipelineStatus[week] = { phase: "error", running: false, error: err.message };
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/pipeline/briefs — generate design briefs */
router.post("/pipeline/briefs", async (req, res) => {
  const { week } = req.body as { week: string };
  const dropDir = path.join(process.cwd(), "drops", week);
  const finalistJson = path.join(dropDir, "01_FINALISTS.md.json");
  if (!fileExists(finalistJson)) return res.status(404).json({ error: "Run scoring first" });

  pipelineStatus[week] = { phase: "generating_briefs", running: true };
  try {
    const finalists = readJson<ScoredConcept[]>(finalistJson);
    const briefs = generateBriefs(finalists, week, dropDir);

    // Generate listings
    const listings = briefs.map((b) => generateListingFromBrief(b, week));
    writeJson(path.join(dropDir, "03_LISTINGS", "_all_listings.json"), listings);
    for (const l of listings) {
      writeJson(path.join(dropDir, "03_LISTINGS", `${l.listing_id}.json`), l);
    }

    // Generate marketing pack
    const topPhrases = finalists.slice(0, 5).map((c) => c.phrase_primary);
    generateEmailSequence(week, `Teejano Drop ${week}`, topPhrases, "https://teejano.com", dropDir);
    const marketingPack = {
      week,
      top_phrases: topPhrases,
      instagram_drop_caption: `New Teejano drop is LIVE.\n\n${topPhrases.slice(0, 2).join(" • ")}\n\nTexas-made. Bold by default.\nLink in bio.\n\n#TexasHumor #TejanosOfTexas #TexasApparel`,
      tiktok_script: `[HOOK] You see this shirt?\n[CONTEXT] This is not a tourist tee. This is Teejano.\n[REVEAL] "${topPhrases[0]}" — drop live now.\n[CTA] Link in bio. Limited run.`,
      sms_drop_live: `Teejano: New drop is LIVE. "${topPhrases[0]}" + more. Shop: https://teejano.com/collections/weekly-drops Reply STOP to opt out.`,
      sms_last_call: `Teejano: Last chance — drop closes tonight. https://teejano.com/collections/weekly-drops Reply STOP to opt out.`,
    };
    writeJson(path.join(dropDir, "04_MARKETING", "marketing_pack.json"), marketingPack);

    // Mockups
    const mockupManifest = await generateMockups(briefs, week, dropDir);

    // Tracking template
    generateTrackingTemplate(week, listings, dropDir);

    // Approval doc
    generateApprovalDoc(week, finalists, dropDir);

    appendLog(dropDir, `Generated ${briefs.length} briefs, ${listings.length} listings, mockups`);
    pipelineStatus[week] = { phase: "awaiting_approval", running: false };

    res.json({ success: true, brief_count: briefs.length, listing_count: listings.length, mockup_count: mockupManifest.mockups.length });
  } catch (err: any) {
    pipelineStatus[week] = { phase: "error", running: false, error: err.message };
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/pipeline/publish — publish to Shopify (requires approved) */
router.post("/pipeline/publish", async (req, res) => {
  const { week } = req.body as { week: string };
  const dropDir = path.join(process.cwd(), "drops", week);
  const approvalPath = path.join(dropDir, "APPROVAL.md");

  if (!fileExists(approvalPath) || !fs.readFileSync(approvalPath, "utf-8").includes("APPROVED=true")) {
    return res.status(403).json({ error: "Drop not approved. Set approval first." });
  }

  pipelineStatus[week] = { phase: "publishing", running: true };
  // Shopify publish is async — kick off and return immediately
  (async () => {
    try {
      const { ShopifyPublisher } = await import("../../scripts/shopify_publisher");
      const listingsPath = path.join(dropDir, "03_LISTINGS", "_all_listings.json");
      const mockupManifestPath = path.join(dropDir, "ASSETS", "MOCKUPS", "mockup_manifest.json");
      if (!fileExists(listingsPath)) throw new Error("No listings found");
      const listings = readJson<any[]>(listingsPath);
      const mockupManifest = fileExists(mockupManifestPath) ? readJson<any>(mockupManifestPath) : { mockups: [] };
      const publisher = new ShopifyPublisher();
      const logs = await publisher.publishDrop(listings, mockupManifest, dropDir);
      appendLog(dropDir, `Published ${logs.filter((l) => l.status === "success").length}/${logs.length} products`);
      pipelineStatus[week] = { phase: "published", running: false };
    } catch (err: any) {
      appendLog(dropDir, `Publish error: ${err.message}`, "ERROR");
      pipelineStatus[week] = { phase: "publish_error", running: false, error: err.message };
    }
  })();

  res.json({ success: true, message: "Publish started — check pipeline status for progress" });
});

/** POST /api/pipeline/postmortem — run analytics ingest */
router.post("/pipeline/postmortem", async (req, res) => {
  const { week } = req.body as { week: string };
  const dropDir = path.join(process.cwd(), "drops", week);
  if (!fileExists(dropDir)) return res.status(404).json({ error: "Drop not found" });

  try {
    const { runAnalyticsIngest } = await import("../../scripts/analytics_ingest");
    await runAnalyticsIngest(week, dropDir);
    const postmortemPath = path.join(dropDir, "POSTMORTEM.md");
    const content = fileExists(postmortemPath) ? fs.readFileSync(postmortemPath, "utf-8") : "";
    res.json({ success: true, postmortem: content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// COWORK — Submit AI responses
// ─────────────────────────────────────────────

/** POST /api/drops/:week/cowork/:source — submit a cowork AI response */
router.post("/drops/:week/cowork/:source", (req, res) => {
  const { week, source } = req.params;
  const validSources = ["chatgpt", "gemini", "design_arena"];
  if (!validSources.includes(source)) return res.status(400).json({ error: "Invalid source" });

  const { content } = req.body as { content: string };
  if (!content) return res.status(400).json({ error: "content required" });

  // Validate it contains parseable JSON array
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return res.status(400).json({ error: "Response must contain a JSON array" });
  try {
    JSON.parse(match[0]);
  } catch {
    return res.status(400).json({ error: "Invalid JSON in response" });
  }

  const inputsDir = path.join(process.cwd(), "drops", week, "COWORK", "inputs");
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.writeFileSync(path.join(inputsDir, `${source}_response.txt`), content);

  res.json({ success: true, source, week });
});

/** POST /api/drops/:week/cowork/:source/generate — call AI directly and store result */
router.post("/drops/:week/cowork/:source/generate", async (req, res) => {
  const { week, source } = req.params;
  const validSources = ["chatgpt", "gemini", "design_arena"] as const;
  if (!validSources.includes(source as typeof validSources[number])) {
    return res.status(400).json({ error: "Invalid source" });
  }

  // Load the prompt for this source
  const fileMap: Record<string, string> = {
    chatgpt: "01_chatgpt_prompt.txt",
    gemini: "02_gemini_prompt.txt",
    design_arena: "03_design_arena_prompt.txt",
  };
  const promptPath = path.join(process.cwd(), "drops", week, "COWORK", fileMap[source]);
  const basePath = path.join(process.cwd(), "prompts", `cowork_${source === "design_arena" ? "design_arena_visual_miner" : source + (source === "chatgpt" ? "_idea_miner" : "_angle_miner")}.txt`);
  const promptFile = fileExists(promptPath) ? promptPath : fileExists(basePath) ? basePath : null;

  if (!promptFile) return res.status(404).json({ error: "Prompt not found. Start a drop first." });

  const prompt = fs.readFileSync(promptFile, "utf-8");

  try {
    const content = await callAI(source as typeof validSources[number], prompt);

    // Validate response contains a JSON array
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(502).json({ error: "AI response did not contain a valid JSON array", raw: content });
    try { JSON.parse(match[0]); } catch {
      return res.status(502).json({ error: "AI response contained malformed JSON", raw: content });
    }

    // Save to COWORK/inputs just like a manual submission
    const inputsDir = path.join(process.cwd(), "drops", week, "COWORK", "inputs");
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.writeFileSync(path.join(inputsDir, `${source}_response.txt`), content);

    res.json({ success: true, source, week, content });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    res.status(500).json({ error: msg });
  }
});

/** GET /api/drops/:week/prompts/:source — get a cowork prompt */
router.get("/drops/:week/prompts/:source", (req, res) => {
  const { week, source } = req.params;
  const fileMap: Record<string, string> = {
    chatgpt: "01_chatgpt_prompt.txt",
    gemini: "02_gemini_prompt.txt",
    design_arena: "03_design_arena_prompt.txt",
  };
  const filename = fileMap[source];
  if (!filename) return res.status(400).json({ error: "Invalid source" });

  const filePath = path.join(process.cwd(), "drops", week, "COWORK", filename);
  if (!fileExists(filePath)) {
    // Fall back to base prompt
    const basePath = path.join(process.cwd(), "prompts", `cowork_${source === "design_arena" ? "design_arena_visual_miner" : source + "_idea_miner"}.txt`);
    if (fileExists(basePath)) return res.json({ prompt: fs.readFileSync(basePath, "utf-8") });
    return res.status(404).json({ error: "Prompt not found. Start a drop first." });
  }
  res.json({ prompt: fs.readFileSync(filePath, "utf-8") });
});

// ─────────────────────────────────────────────
// APPROVAL
// ─────────────────────────────────────────────

/** GET /api/drops/:week/approval */
router.get("/drops/:week/approval", (req, res) => {
  const { week } = req.params;
  const approvalPath = path.join(process.cwd(), "drops", week, "APPROVAL.md");
  if (!fileExists(approvalPath)) return res.json({ approved: false, content: null });
  const content = fs.readFileSync(approvalPath, "utf-8");
  res.json({ approved: content.includes("APPROVED=true"), content });
});

/** POST /api/drops/:week/approve — set approval status */
router.post("/drops/:week/approve", (req, res) => {
  const { week } = req.params;
  const { approved } = req.body as { approved: boolean };
  const approvalPath = path.join(process.cwd(), "drops", week, "APPROVAL.md");
  if (!fileExists(approvalPath)) return res.status(404).json({ error: "Approval doc not found. Generate briefs first." });

  let content = fs.readFileSync(approvalPath, "utf-8");
  content = content.replace(/APPROVED=(true|false)/, `APPROVED=${approved}`);
  fs.writeFileSync(approvalPath, content);

  appendLog(path.join(process.cwd(), "drops", week), `Approval set to ${approved} via web dashboard`);
  res.json({ success: true, approved });
});

// ─────────────────────────────────────────────
// DATA / FILES
// ─────────────────────────────────────────────

/** GET /api/drops/:week/briefs — return design briefs + mockup URLs */
router.get("/drops/:week/briefs", (req, res) => {
  const { week } = req.params;
  const briefsPath = path.join(process.cwd(), "drops", week, "02_DESIGN_BRIEFS", "_all_briefs.json");
  const mockupManifestPath = path.join(process.cwd(), "drops", week, "ASSETS", "MOCKUPS", "mockup_manifest.json");

  const briefs = fileExists(briefsPath) ? readJson<any[]>(briefsPath) : [];
  const manifest = fileExists(mockupManifestPath) ? readJson<any>(mockupManifestPath) : { mockups: [] };

  // Convert absolute file_path to a web-accessible URL
  const cwd = process.cwd();
  const mockups = (manifest.mockups ?? []).map((m: any) => ({
    ...m,
    url: m.file_path
      ? m.file_path.replace(cwd, "").replace(/\\/g, "/")
      : null,
  }));

  res.json({ briefs, mockups });
});

/** PUT /api/drops/:week/finalists/:conceptId — update a finalist concept */
router.put("/drops/:week/finalists/:conceptId", (req, res) => {
  const { week, conceptId } = req.params;
  const dropDir = path.join(process.cwd(), "drops", week);
  const finalistPath = path.join(dropDir, "01_FINALISTS.md.json");
  if (!fileExists(finalistPath)) return res.status(404).json({ error: "Finalists not found" });

  const finalists = readJson<ScoredConcept[]>(finalistPath);
  const idx = finalists.findIndex((f) => f.concept_id === conceptId);
  if (idx === -1) return res.status(404).json({ error: "Concept not found" });

  const editable = ["phrase_primary", "sell_thesis", "audience", "hook", "imagery_notes", "concept_approved"];
  for (const key of editable) {
    if (req.body[key] !== undefined) {
      (finalists[idx] as any)[key] = req.body[key];
    }
  }

  writeJson(finalistPath, finalists);
  appendLog(dropDir, `Concept ${conceptId} updated via web dashboard`);
  res.json({ success: true, concept: finalists[idx] });
});

/** GET /api/drops/:week/log — get run log */
router.get("/drops/:week/log", (req, res) => {
  const { week } = req.params;
  const logPath = path.join(process.cwd(), "drops", week, "LOGS", "run.log");
  if (!fileExists(logPath)) return res.json({ log: "" });
  res.json({ log: fs.readFileSync(logPath, "utf-8") });
});

/** GET /api/drops/:week/marketing — get marketing pack */
router.get("/drops/:week/marketing", (req, res) => {
  const { week } = req.params;
  const marketingPath = path.join(process.cwd(), "drops", week, "04_MARKETING", "marketing_pack.json");
  if (!fileExists(marketingPath)) return res.json({ marketing: null });
  res.json({ marketing: readJson(marketingPath) });
});

/** GET /api/drops/:week/email-sequence — list email files */
router.get("/drops/:week/email-sequence", (req, res) => {
  const { week } = req.params;
  const emailDir = path.join(process.cwd(), "drops", week, "04_MARKETING", "email_sequence");
  if (!fileExists(emailDir)) return res.json({ emails: [] });

  const emails = fs
    .readdirSync(emailDir)
    .filter((f) => f.endsWith("_meta.json"))
    .map((f) => {
      const meta = readJson<any>(path.join(emailDir, f));
      const htmlPath = path.join(emailDir, f.replace("_meta.json", ".html"));
      const html = fileExists(htmlPath) ? fs.readFileSync(htmlPath, "utf-8") : "";
      return { ...meta, html };
    });
  res.json({ emails });
});

/** GET /api/drops/:week/postmortem */
router.get("/drops/:week/postmortem", (req, res) => {
  const { week } = req.params;
  const postmortemPath = path.join(process.cwd(), "drops", week, "POSTMORTEM.md");
  if (!fileExists(postmortemPath)) return res.json({ postmortem: null });
  res.json({ postmortem: fs.readFileSync(postmortemPath, "utf-8") });
});

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const ALLOWED_CONFIGS = ["teejano_rules", "scoring_rubric", "product_defaults", "calendar_config", "email_config", "mockup_config", "shopify_config"];

/** GET /api/config/:name */
router.get("/config/:name", (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_CONFIGS.includes(name)) return res.status(400).json({ error: "Unknown config" });
  const configPath = path.join(process.cwd(), "config", `${name}.json`);
  if (!fileExists(configPath)) return res.status(404).json({ error: "Config not found" });
  res.json(readJson(configPath));
});

/** PUT /api/config/:name */
router.put("/config/:name", (req, res) => {
  const { name } = req.params;
  if (!ALLOWED_CONFIGS.includes(name)) return res.status(400).json({ error: "Unknown config" });
  // Refuse editing shopify/email config with secrets via web
  if (["shopify_config", "email_config"].includes(name)) {
    return res.status(403).json({ error: "Edit secrets via .env file, not the web UI." });
  }
  const configPath = path.join(process.cwd(), "config", `${name}.json`);
  writeJson(configPath, req.body);
  res.json({ success: true });
});

// ─────────────────────────────────────────────
// DATA FILES
// ─────────────────────────────────────────────

/** GET /api/data/blacklist */
router.get("/data/blacklist", (_req, res) => {
  const filePath = path.join(process.cwd(), "data", "blacklist_phrases.txt");
  res.json({ blacklist: fileExists(filePath) ? fs.readFileSync(filePath, "utf-8") : "" });
});

/** POST /api/data/blacklist — append phrases */
router.post("/data/blacklist", (req, res) => {
  const { phrases } = req.body as { phrases: string[] };
  if (!Array.isArray(phrases)) return res.status(400).json({ error: "phrases must be an array" });
  const filePath = path.join(process.cwd(), "data", "blacklist_phrases.txt");
  const addition = phrases.map((p) => p.toLowerCase().trim()).join("\n") + "\n";
  fs.appendFileSync(filePath, `\n# Added via web dashboard\n${addition}`);
  res.json({ success: true });
});

/** GET /api/data/winners */
router.get("/data/winners", (_req, res) => {
  const filePath = path.join(process.cwd(), "data", "winner_patterns.md");
  res.json({ winners: fileExists(filePath) ? fs.readFileSync(filePath, "utf-8") : "" });
});

/** GET /api/data/metrics */
router.get("/data/metrics", (_req, res) => {
  const filePath = path.join(process.cwd(), "data", "metrics_weekly.csv");
  if (!fileExists(filePath)) return res.json({ metrics: [] });

  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  if (lines.length < 2) return res.json({ metrics: [] });

  const headers = lines[0].split(",");
  const metrics = lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = values[i]?.trim() ?? ""; });
    return row;
  });
  res.json({ metrics });
});

// ─────────────────────────────────────────────────────────────────────────────
// IDEAS — Holiday Calendar + Seed Generator
// ─────────────────────────────────────────────────────────────────────────────

interface HolidayDef {
  name: string;
  date: string;          // YYYY-MM-DD
  emoji: string;
  tags: string[];
  leadWeeks: number;     // recommended pipeline lead time
  note: string;
}

const HOLIDAY_DEFS: HolidayDef[] = [
  { name: "Easter",                date: "2026-04-05", emoji: "🐣", tags: ["spring","family"],            leadWeeks: 6, note: "Spring seasonal drop" },
  { name: "Fiesta San Antonio",    date: "2026-04-16", emoji: "🎉", tags: ["texas","tejano","cultural"],   leadWeeks: 8, note: "Major SA cultural festival — Tejano angle essential" },
  { name: "Cinco de Mayo",         date: "2026-05-05", emoji: "🇲🇽", tags: ["tejano","cultural"],         leadWeeks: 6, note: "Core Tejano calendar moment" },
  { name: "Mother's Day",          date: "2026-05-10", emoji: "💐", tags: ["gifts","family"],             leadWeeks: 6, note: "Gift bundles opportunity" },
  { name: "Memorial Day",          date: "2026-05-25", emoji: "🇺🇸", tags: ["patriotic","texas"],         leadWeeks: 5, note: "Summer kickoff + patriotic" },
  { name: "Juneteenth",            date: "2026-06-19", emoji: "✊", tags: ["texas","culture","history"],   leadWeeks: 7, note: "Texas historical significance — thoughtful angle" },
  { name: "Father's Day",          date: "2026-06-21", emoji: "👨", tags: ["gifts","texas"],              leadWeeks: 6, note: "Texas dad energy — gift season" },
  { name: "Independence Day",      date: "2026-07-04", emoji: "🎆", tags: ["patriotic","texas","summer"], leadWeeks: 6, note: "Big summer drop — patriotic + Texas pride" },
  { name: "Back to School",        date: "2026-08-17", emoji: "🎒", tags: ["seasonal","youth"],           leadWeeks: 6, note: "Youth market + campus drops" },
  { name: "Labor Day",             date: "2026-09-07", emoji: "🔧", tags: ["seasonal"],                   leadWeeks: 5, note: "End-of-summer wind-down" },
  { name: "Austin City Limits",    date: "2026-10-02", emoji: "🎸", tags: ["texas","music"],              leadWeeks: 8, note: "Music festival — Texas culture peak" },
  { name: "Halloween",             date: "2026-10-31", emoji: "🎃", tags: ["seasonal","fun"],             leadWeeks: 6, note: "Spooky Texas-themed drop" },
  { name: "Día de los Muertos",    date: "2026-11-02", emoji: "💀", tags: ["tejano","cultural"],          leadWeeks: 6, note: "Core Tejano cultural moment — always strong" },
  { name: "Veterans Day",          date: "2026-11-11", emoji: "🎖",  tags: ["patriotic","texas","military"], leadWeeks: 5, note: "Military + Texas pride crossover" },
  { name: "Thanksgiving",          date: "2026-11-26", emoji: "🦃", tags: ["family","texas"],             leadWeeks: 7, note: "Texas Thanksgiving — biggest gifting week" },
  { name: "Black Friday Drop",     date: "2026-11-27", emoji: "🛍",  tags: ["shopping","drop"],           leadWeeks: 7, note: "Plan your biggest launch for Black Friday" },
  { name: "Christmas",             date: "2026-12-25", emoji: "🎄", tags: ["gifts","family"],             leadWeeks: 8, note: "Biggest gift season — all styles should be live" },
  { name: "New Year's Eve",        date: "2026-12-31", emoji: "🎆", tags: ["celebration"],               leadWeeks: 7, note: "Year-end party drop" },
  { name: "Super Bowl LXI",        date: "2027-02-07", emoji: "🏈", tags: ["sports","texas","party"],     leadWeeks: 7, note: "Sports + Texas party culture — huge" },
  { name: "Valentine's Day",       date: "2027-02-14", emoji: "❤️",  tags: ["gifts","romance"],          leadWeeks: 6, note: "Gift sets + couples drop" },
  { name: "Texas Independence Day",date: "2027-03-02", emoji: "⭐", tags: ["texas","pride","history"],    leadWeeks: 6, note: "Biggest Texas pride moment of the year" },
  { name: "St. Patrick's Day",     date: "2027-03-17", emoji: "☘️", tags: ["fun","social"],              leadWeeks: 5, note: "Bar-crawl season — fun + irreverent" },
];

/** GET /api/ideas/holidays — upcoming holidays with pipeline start deadlines */
router.get("/ideas/holidays", (_req, res) => {
  const now = new Date();

  const result = HOLIDAY_DEFS
    .map((h) => {
      const holidayDate = new Date(h.date);
      const startDate = new Date(holidayDate.getTime() - h.leadWeeks * 7 * 24 * 60 * 60 * 1000);
      const urgentDate = new Date(holidayDate.getTime() - 3 * 7 * 24 * 60 * 60 * 1000);
      const daysUntilHoliday = Math.ceil((holidayDate.getTime() - now.getTime()) / 86400000);
      const daysUntilStart = Math.ceil((startDate.getTime() - now.getTime()) / 86400000);

      let urgency: "past" | "urgent" | "soon" | "ok" | "future";
      if (daysUntilHoliday < -7)        urgency = "past";
      else if (now >= urgentDate)        urgency = "urgent";
      else if (now >= startDate)         urgency = "soon";
      else if (daysUntilStart <= 14)     urgency = "ok";
      else                               urgency = "future";

      return {
        ...h,
        startDate: startDate.toISOString().slice(0, 10),
        daysUntilHoliday,
        daysUntilStart,
        urgency,
      };
    })
    .filter((h) => h.daysUntilHoliday > -8)
    .sort((a, b) => a.daysUntilHoliday - b.daysUntilHoliday);

  res.json({ holidays: result });
});

interface AngleDef {
  angle: string;
  keywords: string[];
  phrases: string[];
  audience: string;
}

const ANGLE_DEFS: AngleDef[] = [
  {
    angle: "self_deprecating_texas",
    keywords: ["heat","hot","sweat","summer","weather","humid","complain","suffer","freeze","cold","flat","boring"],
    phrases: ["SWEATING LIKE A TEXAN", "TOO HOT TO RODEO", "BORN IN THE HEAT", "WE DON'T TALK ABOUT THE COLD"],
    audience: "Texans who embrace the state's quirks, 18-35",
  },
  {
    angle: "texas_pride_deadpan",
    keywords: ["texas","pride","lone star","state","big","best","born","home","flag","cowboy","hat"],
    phrases: ["TEXAS OR NOWHERE", "BORN BLESSED IN TEXAS", "LONE STAR ENERGY", "BIGGER IN TEXAS OBVIOUSLY"],
    audience: "Proud Texans who wear the identity boldly",
  },
  {
    angle: "food_bbq",
    keywords: ["bbq","food","brisket","barbecue","eat","tacos","grill","smoke","pit","brisket","queso","tortilla"],
    phrases: ["BBQ IS MY LOVE LANGUAGE", "BRISKET WEATHER", "TACOS OVER EVERYTHING", "SMOKE SIGNALS"],
    audience: "BBQ lovers, foodies, Texas food culture enthusiasts",
  },
  {
    angle: "tejano_cultural",
    keywords: ["tejano","cultura","heritage","mexican","cinco","dia","muertos","corrido","conjunto","frontera","raza","spanish"],
    phrases: ["PURO TEJANO", "CULTURA FIRST", "FRONTERA FOREVER", "NI DE AQUÍ NI DE ALLÁ"],
    audience: "Texas-Mexican community, Tejano music fans, bilingual Texans",
  },
  {
    angle: "gym_cowboy_crossover",
    keywords: ["gym","workout","fitness","cowboy","boots","rodeo","lift","gains","protein","ranch","strong","build"],
    phrases: ["SPURS & SQUAT RACKS", "COWBOY BUILT DIFFERENT", "BOOTS IN THE GYM", "RODEO GAINZ"],
    audience: "Gym-goers who also love Texas culture, 18-30",
  },
  {
    angle: "outsider_vs_texan",
    keywords: ["california","yankee","outsider","move","transplant","not from","newcomer","relocation","austin"],
    phrases: ["SORRY YOU'RE NOT FROM HERE", "TEXAN BY CHOICE NOT CHANCE", "Y'ALL AREN'T FROM HERE", "WE SAW YOU MOVE IN"],
    audience: "Longtime Texans tired of transplants, 25-45",
  },
  {
    angle: "weather_geography",
    keywords: ["winter","freeze","snow","storm","wind","flat","hill","desert","coast","tornado","thunder","spring"],
    phrases: ["FOUR SEASONS IN ONE DAY", "WEATHERING IT TEXAS STYLE", "FLAT AND PROUD", "TORNADO SEASON REGULAR"],
    audience: "Texans who bond over extreme weather and geography",
  },
  {
    angle: "sports_generic",
    keywords: ["football","baseball","basketball","astros","texans","cowboys","superbowl","sports","game","tailgate","stadium"],
    phrases: ["GAME DAY STATE OF MIND", "TEXAS SPORTS RELIGION", "SUNDAY FOOTBALL MANDATORY", "TAILGATE ROYALTY"],
    audience: "Sports fans, game-day shirt buyers, 21-45",
  },
];

/** POST /api/ideas/seeds — generate concept seeds from user preferences */
router.post("/ideas/seeds", (req, res) => {
  const { preferences = "", holiday = "", holiday_tags = [] } = req.body ?? {};
  const text = `${preferences} ${(holiday_tags as string[]).join(" ")} ${holiday}`.toLowerCase();

  // Score each angle by keyword overlap
  const scored = ANGLE_DEFS
    .map((a) => ({
      ...a,
      score: a.keywords.filter((k) => text.includes(k)).length,
    }))
    .sort((a, b) => b.score - a.score);

  const seeds: object[] = [];

  // Holiday-pinned seed (if a holiday was selected)
  if (holiday) {
    const topAngle = scored[0];
    seeds.push({
      phrase: `${holiday.toUpperCase()} TEXAS STYLE`,
      angle: topAngle?.angle ?? "texas_pride_deadpan",
      audience: topAngle?.audience ?? "Texas streetwear fans",
      sell_thesis: `Seasonal drop tied to ${holiday} with a Texas twist`,
      is_holiday_seed: true,
    });
  }

  // Take top 3 matching angles (or top 3 overall if no matches), 2 phrases each
  const topAngles = scored.filter((_, i) => i < 3);
  for (const a of topAngles) {
    for (const phrase of a.phrases.slice(0, 2)) {
      if (seeds.length >= 8) break;
      seeds.push({
        phrase,
        angle: a.angle,
        audience: a.audience,
        sell_thesis: `Plays on Texas identity and ${a.angle.replace(/_/g, " ")} humor`,
        is_holiday_seed: false,
      });
    }
  }

  // If no preferences matched anything, fall back to all top-of-list phrases
  if (seeds.length < 4 && !preferences.trim()) {
    for (const a of ANGLE_DEFS.slice(0, 4)) {
      seeds.push({
        phrase: a.phrases[0],
        angle: a.angle,
        audience: a.audience,
        sell_thesis: `Classic ${a.angle.replace(/_/g, " ")} angle`,
        is_holiday_seed: false,
      });
    }
  }

  res.json({ seeds: seeds.slice(0, 8) });
});

/** GET /api/health */
router.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "2.0.0", current_week: getCurrentWeek() });
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function generateListingFromBrief(brief: any, week: string): any {
  const slug = brief.phrase.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 50);
  const listingId = `${brief.asset_id}-LISTING`;
  const handle = `teejano-${slug}-${week.replace("-", "").toLowerCase()}`;
  const garmentDesc = ["Pepper", "Ivory", "Butter"].includes(brief.colorways?.garment_color)
    ? "Comfort Colors heavyweight tee" : "Bella+Canvas unisex tee";

  return {
    listing_id: listingId,
    concept_id: brief.concept_id,
    asset_id: brief.asset_id,
    created_at: new Date().toISOString(),
    status: "draft",
    title_seo: `${brief.phrase} | Texas Humor Tee — Teejano`.slice(0, 70),
    description_html: `<p><strong>${brief.phrase}</strong> — Because Texas doesn't need an explanation.</p><p>Printed on a ${garmentDesc}. Soft. Structured. Built to wear.</p><p><strong>Fit:</strong> Unisex. True to size.</p>`,
    meta_description: `${brief.phrase} — Teejano Texas humor tee. Bold. Clean. Made for Texans.`.slice(0, 155),
    collections: ["General Texas Humor", "Weekly Drops"],
    tags: ["texas-humor", "texas-tee", "teejano", `drop-${week.toLowerCase()}`],
    handle,
    price: 29.99,
    compare_at_price: 36.99,
    mockup_urls: [],
    alt_texts: { primary: `${brief.phrase} — Teejano Texas humor tee` },
    launch_type: "drop",
  };
}

function generateApprovalDoc(week: string, finalists: ScoredConcept[], dropDir: string): void {
  const lines = [
    `# APPROVAL CHECKLIST — ${week}\n`,
    `APPROVED=false\n`,
    `---\n`,
    `## Finalists (${finalists.length} concepts)\n`,
    ...finalists.map((c, i) =>
      `### ${i + 1}. "${c.phrase_primary}" (Score: ${c.total_score}/100)\n- [ ] Phrase approved\n- [ ] No copyright risk\n- Angle: ${c.angle}\n`
    ),
    `---\n`,
    `## Pre-publish Checklist\n`,
    `- [ ] Mockups reviewed\n- [ ] Listings reviewed in Shopify draft\n- [ ] Email sequence approved\n- [ ] No trademark violations\n`,
  ];
  fs.writeFileSync(path.join(dropDir, "APPROVAL.md"), lines.join("\n"));
}
