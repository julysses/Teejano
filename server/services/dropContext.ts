/**
 * dropContext.ts — Builds the per-drop context block injected into the master design prompt.
 * Makes each drop unique by surfacing upcoming holidays, season, and user-supplied trends.
 */

import fs from "fs";
import path from "path";

interface SeasonalEvent {
  month: number;
  week: number;
  category: string;
  boost: boolean;
}

interface CalendarConfig {
  seasonal_events: Record<string, SeasonalEvent>;
}

/** Parse a week string like "2025-W10" into year and ISO week number. */
function parseWeek(week: string): { year: number; isoWeek: number } {
  const m = week.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return { year: new Date().getFullYear(), isoWeek: 1 };
  return { year: parseInt(m[1]), isoWeek: parseInt(m[2]) };
}

/** Approximate the start date of an ISO week. */
function isoWeekToDate(year: number, isoWeek: number): Date {
  const jan4 = new Date(year, 0, 4); // Jan 4 is always in week 1
  const dayOfWeek = jan4.getDay() || 7; // Mon=1 … Sun=7
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - (dayOfWeek - 1) + (isoWeek - 1) * 7);
  return weekStart;
}

function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  if (month >= 9 && month <= 11) return "Fall";
  return "Winter";
}

/** Find seasonal events that fall within 21 days of the drop start date. */
function getUpcomingEvents(dropDate: Date, events: Record<string, SeasonalEvent>): string[] {
  const upcoming: string[] = [];
  const windowEnd = new Date(dropDate);
  windowEnd.setDate(dropDate.getDate() + 21);

  for (const [name, ev] of Object.entries(events)) {
    // Approximate event date: first day of that month/week
    const evDate = new Date(dropDate.getFullYear(), ev.month - 1, 1 + (ev.week - 1) * 7);
    // Try next year if this year's event already passed
    if (evDate < dropDate) {
      evDate.setFullYear(dropDate.getFullYear() + 1);
    }
    if (evDate >= dropDate && evDate <= windowEnd) {
      const boost = ev.boost ? " (PRIORITY — design opportunity)" : "";
      upcoming.push(`- ${name}${boost} — ${evDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`);
    }
  }
  return upcoming;
}

/**
 * Build the drop context block prepended to the master prompt.
 * @param week  ISO week string, e.g. "2025-W10"
 * @param trends  Free-text trends/news/design notes supplied by the user
 */
export function buildDropContext(week: string, trends: string = ""): string {
  const { year, isoWeek } = parseWeek(week);
  const dropStart = isoWeekToDate(year, isoWeek);
  const dropEnd = new Date(dropStart);
  dropEnd.setDate(dropStart.getDate() + 6);

  const month = dropStart.getMonth() + 1;
  const season = getSeason(month);

  // Load calendar config for holidays
  let upcomingLines: string[] = [];
  try {
    const calPath = path.join(process.cwd(), "config", "calendar_config.json");
    const cal: CalendarConfig = JSON.parse(fs.readFileSync(calPath, "utf-8"));
    upcomingLines = getUpcomingEvents(dropStart, cal.seasonal_events);
  } catch {
    // calendar config missing — skip
  }

  const dateRange = `${dropStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })}–${dropEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const lines: string[] = [
    `---`,
    `# DROP CONTEXT: ${week} (${dateRange})`,
    ``,
    `## CURRENT SEASON`,
    `${season} ${year} — Month ${month}`,
    ``,
  ];

  if (upcomingLines.length > 0) {
    lines.push(`## UPCOMING HOLIDAYS & EVENTS (next 21 days)`);
    lines.push(...upcomingLines);
    lines.push(`Design concepts that tie into these events will have higher seasonal demand.`);
    lines.push(``);
  }

  if (trends.trim()) {
    lines.push(`## THIS WEEK'S TRENDS, NEWS & DESIGN FOCUS`);
    lines.push(trends.trim());
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Combine the drop context block with the master design engine prompt.
 * The context is injected at the top so the AI sees it before all instructions.
 */
export function buildFullPrompt(week: string, trends: string = ""): string {
  const masterPath = path.join(process.cwd(), "prompts", "master_design_engine.txt");
  const master = fs.readFileSync(masterPath, "utf-8");
  const context = buildDropContext(week, trends);
  return context + master;
}
