import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/** Get current week string in YYYY-WW format (ISO week) */
export function getCurrentWeek(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Create drop directory structure for a given week */
export function createDropDir(week: string): string {
  const base = path.join(process.cwd(), "drops", week);
  const dirs = [
    base,
    path.join(base, "COWORK", "inputs"),
    path.join(base, "02_DESIGN_BRIEFS"),
    path.join(base, "03_LISTINGS"),
    path.join(base, "04_MARKETING"),
    path.join(base, "ASSETS", "DESIGNS"),
    path.join(base, "ASSETS", "MOCKUPS"),
    path.join(base, "PUBLISH"),
    path.join(base, "LOGS"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return base;
}

/** Slugify a phrase for use in filenames and handles */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

/** Generate deterministic filename per spec: {week}_{concept_id}_{slug}_{variant}_{asset} */
export function makeFilename(
  week: string,
  conceptId: string,
  slug: string,
  variant: string,
  asset: string,
  ext = "png"
): string {
  const weekClean = week.replace("-", "");
  return `${weekClean}_${conceptId}_${slug}_${variant}_${asset}.${ext}`;
}

/** Read JSON config file with env var substitution */
export function loadConfig<T>(configPath: string): T {
  const raw = fs.readFileSync(configPath, "utf-8");
  const substituted = raw.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, key, fallback) => {
    return process.env[key] ?? fallback ?? `\${${key}}`;
  });
  return JSON.parse(substituted) as T;
}

/** Append a log line to a run.log file */
export function log(dropDir: string, message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const logFile = path.join(dropDir, "LOGS", "run.log");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
}

/** Write JSON file with pretty print */
export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/** Read JSON file */
export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/** Check if a file exists */
export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Parse CLI args: --week 2024-W48 --mode draft */
export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = val;
    }
  }
  return args;
}

/** Load blacklist phrases from file */
export function loadBlacklist(): Set<string> {
  const file = path.join(process.cwd(), "data", "blacklist_phrases.txt");
  if (!fileExists(file)) return new Set();
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  const phrases = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      phrases.add(trimmed.toLowerCase());
    }
  }
  return phrases;
}

/** Check if a phrase contains blacklisted content */
export function containsBlacklisted(phrase: string, blacklist: Set<string>): string | null {
  const lower = phrase.toLowerCase();
  for (const banned of blacklist) {
    if (lower.includes(banned)) return banned;
  }
  return null;
}

/** Append row to CSV file */
export function appendCsv(csvPath: string, row: Record<string, string | number | boolean | null>): void {
  const exists = fileExists(csvPath);
  const values = Object.values(row).map((v) => {
    if (v === null || v === undefined) return "";
    const str = String(v);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  });
  if (!exists) {
    const headers = Object.keys(row).join(",") + "\n";
    fs.writeFileSync(csvPath, headers);
  }
  fs.appendFileSync(csvPath, values.join(",") + "\n");
}

/** Sleep for ms milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prompt user for input in terminal */
export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
