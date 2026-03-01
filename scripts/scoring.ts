/**
 * scoring.ts — Brand Guardian + Scorer
 * Filters and scores design concepts based on teejano_rules + scoring_rubric
 */

import * as path from "path";
import { CoworkInput, DesignConcept, ScoredConcept, HumorAngle } from "./types";
import { loadConfig, loadBlacklist, containsBlacklisted, slugify } from "./utils";

interface ScoringRubric {
  dimensions: Record<string, { weight: number; description: string }>;
  thresholds: { auto_approve: number; review_required: number; auto_reject: number };
  diversity_rules: { min_humor_angles: number; max_same_angle: number; humor_angles: string[] };
  hard_disqualifiers: string[];
}

interface TeejanoRules {
  design_principles: { phrase_length: { max_words: number } };
  prohibited: { banned_examples: string[] };
}

/** Normalize raw cowork output to DesignConcept format */
export function normalizeCoworkInput(raw: CoworkInput, source: string, week: string): DesignConcept {
  const conceptId = `${raw.CONCEPT_ID}-${source}-${week.replace("-", "")}`;
  return {
    concept_id: conceptId,
    created_at: new Date().toISOString(),
    created_by: "ai",
    status: "draft",
    category: "general_texas_humor",
    audience: raw.TARGET,
    hook: raw.VISUAL_HOOK,
    phrase_primary: raw.PHRASE,
    phrase_alt_1: raw.VARIANTS[0]?.phrase,
    phrase_alt_2: raw.VARIANTS[1]?.phrase,
    imagery_notes: raw.VISUAL_HOOK,
    style_tags: [],
    bilingual_level: detectBilingual(raw.PHRASE),
    risk_flags: [],
    uniqueness_score: 5,
    sell_thesis: raw.NOTES,
    priority: 3,
    angle: (raw.ANGLE as HumorAngle) || "texas_pride_deadpan",
    variants: raw.VARIANTS,
  };
}

/** Detect bilingual level from phrase */
function detectBilingual(phrase: string): "none" | "light" | "medium" {
  const spanishWords = ["mijo", "órale", "ándale", "chingón", "tejano", "vaquero", "rancho", "corazón", "fierro", "compa"];
  const lower = phrase.toLowerCase();
  const matches = spanishWords.filter((w) => lower.includes(w)).length;
  if (matches === 0) return "none";
  if (matches === 1) return "light";
  return "medium";
}

/** Hard disqualification check — returns reason string or null if passes */
export function hardDisqualify(concept: DesignConcept, blacklist: Set<string>): string | null {
  const phrase = concept.phrase_primary;

  // Blacklist check
  const banned = containsBlacklisted(phrase, blacklist);
  if (banned) return `blacklist_match:${banned}`;

  // Word count check
  const wordCount = phrase.trim().split(/\s+/).length;
  if (wordCount > 8) return "phrase_too_long";

  // Empty phrase
  if (!phrase || phrase.trim().length < 2) return "empty_phrase";

  // Check for explicit trademark red flags (common brand names)
  const trademarkRed = ["©", "®", "™"];
  if (trademarkRed.some((t) => phrase.includes(t))) return "trademark_symbol";

  return null;
}

/** Score a concept on all 5 dimensions (0–20 each) using heuristic rules */
export function scoreConcept(concept: DesignConcept): ScoredConcept["scores"] {
  const phrase = concept.phrase_primary.toLowerCase();
  const wordCount = phrase.trim().split(/\s+/).length;

  // CLARITY (0–20)
  let clarity = 10;
  if (wordCount <= 4) clarity += 6;
  else if (wordCount <= 6) clarity += 3;
  if (phrase.length < 25) clarity += 4;

  // TEXAS-NESS (0–20)
  let texasNess = 8;
  const texasMarkers = ["texas", "tx", "tejano", "lone star", "houston", "dallas", "austin",
    "el paso", "san antonio", "hill country", "gulf", "cowboy", "rodeo", "bbq", "brisket",
    "longhorn", "rattlesnake", "armadillo", "blue norther", "y'all", "fixin"];
  const texasHits = texasMarkers.filter((m) => phrase.includes(m)).length;
  texasNess += Math.min(texasHits * 3, 12);

  // HUMOR PUNCH (0–20)
  let humorPunch = 8;
  const humorAngles = ["outsider_vs_texan", "gym_cowboy_crossover", "tejano_cultural", "self_deprecating_texas"];
  if (humorAngles.includes(concept.angle)) humorPunch += 4;
  if (concept.bilingual_level === "light") humorPunch += 3;
  if (wordCount >= 2 && wordCount <= 5) humorPunch += 5;

  // WEARABILITY (0–20)
  let wearability = 10;
  if (wordCount <= 5) wearability += 5;
  if (!phrase.match(/[!]{2,}/)) wearability += 3;  // not overly aggressive
  if (concept.bilingual_level !== "medium") wearability += 2;

  // PRINT SIMPLICITY (0–20)
  let printSimplicity = 14;
  if (wordCount <= 4) printSimplicity += 4;
  else if (wordCount <= 6) printSimplicity += 2;
  if (!concept.imagery_notes?.toLowerCase().includes("gradient")) printSimplicity += 2;

  // Cap all at 20
  return {
    clarity: Math.min(clarity, 20),
    texas_ness: Math.min(texasNess, 20),
    humor_punch: Math.min(humorPunch, 20),
    wearability: Math.min(wearability, 20),
    print_simplicity: Math.min(printSimplicity, 20),
  };
}

/** Full brand guardian filter + score pipeline */
export function filterAndScore(concepts: DesignConcept[]): ScoredConcept[] {
  const blacklist = loadBlacklist();
  const results: ScoredConcept[] = [];

  for (const concept of concepts) {
    const disqualifyReason = hardDisqualify(concept, blacklist);
    if (disqualifyReason) {
      results.push({
        ...concept,
        status: "rejected",
        risk_flags: [...concept.risk_flags, disqualifyReason],
        scores: { clarity: 0, texas_ness: 0, humor_punch: 0, wearability: 0, print_simplicity: 0 },
        total_score: 0,
        disqualified: true,
        disqualify_reason: disqualifyReason,
      });
      continue;
    }

    const scores = scoreConcept(concept);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    const rubric = loadConfig<ScoringRubric>(path.join(process.cwd(), "config", "scoring_rubric.json"));
    const status = total >= rubric.thresholds.auto_approve ? "approved"
      : total >= rubric.thresholds.review_required ? "draft"
      : "rejected";

    results.push({
      ...concept,
      status,
      scores,
      total_score: total,
      disqualified: false,
    });
  }

  return results;
}

/** Select top N finalists with diversity enforcement */
export function selectFinalists(scored: ScoredConcept[], count = 12): ScoredConcept[] {
  const rubric = loadConfig<ScoringRubric>(path.join(process.cwd(), "config", "scoring_rubric.json"));

  const approved = scored
    .filter((c) => !c.disqualified && c.total_score >= rubric.thresholds.review_required)
    .sort((a, b) => b.total_score - a.total_score);

  const finalists: ScoredConcept[] = [];
  const angleCounts: Record<string, number> = {};

  for (const concept of approved) {
    if (finalists.length >= count) break;
    const angle = concept.angle;
    const count_for_angle = angleCounts[angle] ?? 0;
    if (count_for_angle >= rubric.diversity_rules.max_same_angle) continue;
    finalists.push({ ...concept, status: "approved" });
    angleCounts[angle] = count_for_angle + 1;
  }

  return finalists;
}
