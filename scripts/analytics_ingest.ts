/**
 * analytics_ingest.ts — Post-launch analytics ingestion + feedback loop
 * Pulls Shopify performance data, generates postmortem, updates knowledge base
 */

import * as fs from "fs";
import * as path from "path";
import { loadConfig, writeJson, readJson, appendCsv, log, fileExists } from "./utils";

interface ShopifyConfig {
  shop_domain: string;
  admin_access_token: string;
  api_version: string;
}

interface MetricsRow {
  week: string;
  listing_id: string;
  concept_id: string;
  phrase_primary: string;
  category: string;
  garment_color: string;
  views: number;
  add_to_carts: number;
  orders: number;
  revenue: number;
  ctr: number;
  conversion_rate: number;
  aov: number;
  winner: boolean;
  notes: string;
}

const ORDERS_QUERY = `
  query getOrdersByTag($tag: String!) {
    orders(first: 250, query: $tag) {
      edges {
        node {
          id
          name
          totalPriceSet { shopMoney { amount } }
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                product {
                  id
                  handle
                  tags
                  metafields(namespace: "teejano", first: 5) {
                    edges {
                      node { key value }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Pull orders from Shopify for a given week tag */
async function fetchShopifyOrders(week: string): Promise<Map<string, { units: number; revenue: number; handle: string }>> {
  const config = loadConfig<ShopifyConfig>(path.join(process.cwd(), "config", "shopify_config.json"));

  if (!config.admin_access_token || config.admin_access_token.startsWith("${")) {
    throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN not configured");
  }

  const url = `https://${config.shop_domain}/admin/api/${config.api_version}/graphql.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.admin_access_token,
    },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { tag: `drop_week:${week}` },
    }),
  });

  if (!response.ok) throw new Error(`Shopify API error: ${response.status}`);
  const json = await response.json() as { data: { orders: { edges: Array<any> } } };

  const productMap = new Map<string, { units: number; revenue: number; handle: string }>();

  for (const { node: order } of json.data.orders.edges) {
    for (const { node: item } of order.lineItems.edges) {
      const productId = item.product?.id;
      if (!productId) continue;
      const existing = productMap.get(productId) ?? { units: 0, revenue: 0, handle: item.product.handle };
      existing.units += item.quantity;
      existing.revenue += parseFloat(order.totalPriceSet.shopMoney.amount) * (item.quantity / order.lineItems.edges.length);
      productMap.set(productId, existing);
    }
  }

  return productMap;
}

/** Load metrics from manual CSV (fallback if Shopify API unavailable) */
function loadManualMetrics(csvPath: string): MetricsRow[] {
  if (!fileExists(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, "utf-8").split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h.trim()] = values[i]?.trim() ?? ""; });
    return {
      week: obj.week,
      listing_id: obj.listing_id,
      concept_id: obj.concept_id,
      phrase_primary: obj.phrase_primary,
      category: obj.category,
      garment_color: obj.garment_color,
      views: parseInt(obj.views) || 0,
      add_to_carts: parseInt(obj.add_to_carts) || 0,
      orders: parseInt(obj.orders) || 0,
      revenue: parseFloat(obj.revenue) || 0,
      ctr: parseFloat(obj.ctr) || 0,
      conversion_rate: parseFloat(obj.conversion_rate) || 0,
      aov: parseFloat(obj.aov) || 0,
      winner: obj.winner === "true",
      notes: obj.notes,
    };
  });
}

/** Analyze metrics and identify winners/losers */
function analyzeMetrics(metrics: MetricsRow[]): {
  winners: MetricsRow[];
  losers: MetricsRow[];
  topPhrases: string[];
  topColors: string[];
  topAngles: string[];
  avgConversionRate: number;
  totalRevenue: number;
} {
  if (metrics.length === 0) {
    return { winners: [], losers: [], topPhrases: [], topColors: [], topAngles: [], avgConversionRate: 0, totalRevenue: 0 };
  }

  const sorted = [...metrics].sort((a, b) => b.revenue - a.revenue);
  const median = sorted[Math.floor(sorted.length / 2)]?.revenue ?? 0;

  const winners = sorted.filter((m) => m.revenue > median * 1.5 || m.orders >= 5);
  const losers = sorted.filter((m) => m.revenue < median * 0.3 && m.orders < 2);

  const colorCount: Record<string, number> = {};
  for (const m of winners) {
    colorCount[m.garment_color] = (colorCount[m.garment_color] ?? 0) + m.orders;
  }

  const totalRevenue = metrics.reduce((sum, m) => sum + m.revenue, 0);
  const avgCR = metrics.reduce((sum, m) => sum + m.conversion_rate, 0) / metrics.length;

  return {
    winners,
    losers,
    topPhrases: winners.slice(0, 5).map((w) => w.phrase_primary),
    topColors: Object.entries(colorCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
    topAngles: [...new Set(winners.map((w) => w.category))].slice(0, 3),
    avgConversionRate: avgCR,
    totalRevenue,
  };
}

/** Generate POSTMORTEM.md for a drop week */
function generatePostmortem(week: string, analysis: ReturnType<typeof analyzeMetrics>, dropDir: string): void {
  const md = `# Drop Postmortem — ${week}
Generated: ${new Date().toISOString()}

---

## Performance Summary
- **Total Revenue:** $${analysis.totalRevenue.toFixed(2)}
- **Avg Conversion Rate:** ${(analysis.avgConversionRate * 100).toFixed(2)}%
- **Total Products Tracked:** ${analysis.winners.length + analysis.losers.length}

---

## Winners (Top Performers)
${analysis.winners.length === 0 ? "_No data yet_" : analysis.winners.map((w) =>
  `- **${w.phrase_primary}** — ${w.orders} orders / $${w.revenue.toFixed(2)} / ${(w.conversion_rate * 100).toFixed(1)}% CR`
).join("\n")}

## Losers (Low Performers)
${analysis.losers.length === 0 ? "_No data yet_" : analysis.losers.map((l) =>
  `- **${l.phrase_primary}** — ${l.orders} orders / $${l.revenue.toFixed(2)}`
).join("\n")}

---

## Key Insights

### Top Phrases That Worked
${analysis.topPhrases.length === 0 ? "_No data yet_" : analysis.topPhrases.map((p) => `- ${p}`).join("\n")}

### Top Garment Colors
${analysis.topColors.length === 0 ? "_No data yet_" : analysis.topColors.map((c) => `- ${c}`).join("\n")}

### Top Categories
${analysis.topAngles.length === 0 ? "_No data yet_" : analysis.topAngles.map((a) => `- ${a}`).join("\n")}

---

## Recommendations for Next Drop
${analysis.winners.length > 0 ? `
- **Double down on:** ${analysis.topPhrases[0] ?? "top phrases"} style concepts
- **Garment color priority:** ${analysis.topColors[0] ?? "Black"} first
- **Humor angle priority:** ${analysis.topAngles[0] ?? "current angles"}
- **Retire:** ${analysis.losers.slice(0, 2).map((l) => `"${l.phrase_primary}"`).join(", ") || "nothing yet"}
` : "_Run a full drop first, then postmortem insights will populate here._"}

---

_Auto-generated by Teejano Analytics Agent. Review and adjust before using in ideation._
`;

  fs.writeFileSync(path.join(dropDir, "POSTMORTEM.md"), md);
}

/** Update the global winner_patterns.md and blacklist */
function updateKnowledgeBase(week: string, analysis: ReturnType<typeof analyzeMetrics>): void {
  const winnerPath = path.join(process.cwd(), "data", "winner_patterns.md");
  const blacklistPath = path.join(process.cwd(), "data", "blacklist_phrases.txt");

  // Auto-add repeated losers to blacklist
  if (analysis.losers.length > 0) {
    const currentBlacklist = fileExists(blacklistPath) ? fs.readFileSync(blacklistPath, "utf-8") : "";
    const additions: string[] = [];
    for (const loser of analysis.losers) {
      if (loser.orders === 0 && !currentBlacklist.includes(loser.phrase_primary.toLowerCase())) {
        additions.push(`${loser.phrase_primary.toLowerCase()} # auto-added ${week} (0 orders)`);
      }
    }
    if (additions.length > 0) {
      fs.appendFileSync(blacklistPath, "\n# === AUTO-ADDED from " + week + " ===\n" + additions.join("\n") + "\n");
    }
  }

  // Append to winner_patterns.md
  if (analysis.winners.length > 0) {
    const update = `\n## Update: ${week}\n${analysis.winners.slice(0, 3).map((w) =>
      `- **${w.phrase_primary}** — ${w.orders} orders, $${w.revenue.toFixed(2)}`
    ).join("\n")}\n`;
    fs.appendFileSync(winnerPath, update);
  }
}

/** Main: run analytics ingest for a week */
export async function runAnalyticsIngest(week: string, dropDir: string): Promise<void> {
  log(dropDir, `Starting analytics ingest for ${week}`);

  let metrics: MetricsRow[] = [];

  // Try Shopify API first
  try {
    const shopifyData = await fetchShopifyOrders(week);
    log(dropDir, `Fetched ${shopifyData.size} products from Shopify API`);
  } catch (err: any) {
    log(dropDir, `Shopify API unavailable (${err.message}) — using manual CSV fallback`, "WARN");
    metrics = loadManualMetrics(path.join(process.cwd(), "data", "metrics_weekly.csv"));
    metrics = metrics.filter((m) => m.week === week);
  }

  const analysis = analyzeMetrics(metrics);
  generatePostmortem(week, analysis, dropDir);
  updateKnowledgeBase(week, analysis);

  log(dropDir, `Analytics ingest complete. Postmortem written to ${dropDir}/POSTMORTEM.md`);
}

/** Generate the tracking template CSV for a drop */
export function generateTrackingTemplate(
  week: string,
  listings: Array<{ listing_id: string; concept_id: string; handle: string; title_seo: string }>,
  dropDir: string
): void {
  const header = "week,listing_id,concept_id,phrase_primary,category,garment_color,views,add_to_carts,orders,revenue,ctr,conversion_rate,aov,winner,notes";
  const rows = listings.map((l) =>
    `${week},${l.listing_id},${l.concept_id},"${l.title_seo}",general_texas_humor,,0,0,0,0,0,0,0,false,`
  );
  const content = [header, ...rows].join("\n");
  fs.writeFileSync(path.join(dropDir, "06_TRACKING_TEMPLATE.csv"), content);
}
