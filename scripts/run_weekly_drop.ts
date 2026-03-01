#!/usr/bin/env ts-node
/**
 * run_weekly_drop.ts — Main entrypoint
 *
 * Usage:
 *   npx ts-node scripts/run_weekly_drop.ts --week 2024-W48 --mode draft
 *   npx ts-node scripts/run_weekly_drop.ts --week 2024-W48 --mode publish
 *   npx ts-node scripts/run_weekly_drop.ts --mode draft   (uses current week)
 *
 *   npx ts-node scripts/run_weekly_drop.ts --postmortem --week 2024-W48
 */

import { parseArgs, getCurrentWeek } from "./utils";
import { runWeeklyDrop, runPostmortem } from "./orchestrator";

async function main() {
  const args = parseArgs(process.argv);

  const week = args.week ?? getCurrentWeek();
  const mode = (args.mode ?? "draft") as "draft" | "publish";

  if (!["draft", "publish"].includes(mode)) {
    console.error(`Invalid mode: "${mode}". Must be "draft" or "publish".`);
    process.exit(1);
  }

  if (args.postmortem !== undefined) {
    await runPostmortem(week);
  } else {
    await runWeeklyDrop(week, mode);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
