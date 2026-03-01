# 🤠 Teejano Autonomous Merch Agency — V2

> Texas-first streetwear POD brand powered by Claude Code agents.
> Ideation → Design Briefs → Mockups → Shopify → Email/SMS → Analytics → Feedback Loop.

---

## What This Is

A vertically integrated creative pipeline that automates weekly curated drops for Teejano — a Texas & Tejano streetwear brand. Each week, the system:

1. Generates AI ideation prompts (for ChatGPT/Gemini/Design Arena)
2. Parses + scores concepts (Brand Guardian filter + 5-dimension scoring)
3. Selects top 12 finalists with diversity enforcement
4. Generates design briefs (2 variants each)
5. Generates Shopify listings + marketing copy (IG, TikTok, Email, SMS)
6. Generates product mockups (ImageMagick composite)
7. Publishes to Shopify via Admin GraphQL API
8. Schedules email sequences via Klaviyo
9. Ingests analytics and updates the knowledge base

---

## Quick Start

```bash
# Install dependencies
npm install

# Run a drop in draft mode (no API calls)
npm run drop:draft
# or
npx ts-node scripts/run_weekly_drop.ts --week 2025-W10 --mode draft

# After cowork inputs + approval, publish
npx ts-node scripts/run_weekly_drop.ts --week 2025-W10 --mode publish

# Run postmortem after drop closes
npx ts-node scripts/run_weekly_drop.ts --postmortem --week 2025-W10
```

---

## Project Structure

```
teejano-agency/
├── config/
│   ├── teejano_rules.json        Brand voice, design principles, prohibited
│   ├── scoring_rubric.json       5-dimension scoring (clarity/texas-ness/humor/wearability/print)
│   ├── product_defaults.json     Blank garments, print areas, collections
│   ├── shopify_config.json       Shopify API config (env vars)
│   ├── email_config.json         Klaviyo/SMS config (env vars)
│   ├── mockup_config.json        Template mappings, print zones
│   └── calendar_config.json      Weekly cadence, seasonal events
│
├── data/
│   ├── design_ideas_master.csv   All concepts history
│   ├── drops.csv                 Drop tracking
│   ├── metrics_weekly.csv        Performance data
│   ├── blacklist_phrases.txt     Auto-updated banned phrases
│   └── winner_patterns.md        Knowledge base of what works
│
├── prompts/
│   ├── cowork_chatgpt_idea_miner.txt     ChatGPT ideation prompt
│   ├── cowork_gemini_angle_miner.txt     Gemini angle mining prompt
│   ├── cowork_design_arena_visual_miner.txt  Visual-first prompt
│   ├── listing_generator.txt             Shopify copy prompt
│   ├── marketing_generator.txt           Social/email/SMS copy prompt
│   └── email_sequence_generator.txt      Full email sequence prompt
│
├── scripts/
│   ├── run_weekly_drop.ts        MAIN ENTRYPOINT
│   ├── orchestrator.ts           State machine + pipeline runner
│   ├── scoring.ts                Brand Guardian + 5D scorer
│   ├── brief_factory.ts          Design brief generator
│   ├── mockup_generator.ts       LocalCompositeAdapter (ImageMagick)
│   ├── shopify_publisher.ts      GraphQL publisher
│   ├── email_automations.ts      Klaviyo + fallback email builder
│   ├── analytics_ingest.ts       Postmortem + feedback loop
│   ├── types.ts                  Shared TypeScript types
│   └── utils.ts                  Utilities (logging, CSV, slugify)
│
├── templates/
│   ├── briefs/design_brief.md    Design brief template
│   ├── listings/shopify_product.json  Product listing template
│   ├── marketing/                IG/TikTok/SMS templates
│   └── mockups/mockup_manifest.json
│
├── assets/mockups/blanks/        Blank shirt PNGs (add your own)
│
├── drops/                        Generated per-week drop folders
│   └── 2025-W10/                 Example week
│       ├── COWORK/               AI tool prompts + inputs
│       ├── 01_FINALISTS.md       Top scoring concepts
│       ├── 02_DESIGN_BRIEFS/     Per-concept production briefs
│       ├── 03_LISTINGS/          Shopify-ready product copy
│       ├── 04_MARKETING/         Social + email + SMS pack
│       ├── 05_MOCKUP_SHOTLIST.md Production checklist
│       ├── 06_TRACKING_TEMPLATE.csv  Fill in after drop goes live
│       ├── APPROVAL.md           Human review gate
│       ├── ASSETS/               Designs + mockup images
│       ├── PUBLISH/              Shopify publish logs
│       ├── LOGS/run.log          Full run log
│       └── POSTMORTEM.md         Post-drop analytics
│
└── docs/
    ├── SETUP.md                  Installation + configuration
    ├── OPERATIONS.md             Weekly workflow
    ├── API_KEYS.md               Where to get each API key
    └── RUNBOOK.md                Failure modes + recovery
```

---

## Scoring System

Each concept is scored 0–100 across 5 dimensions (20 pts each):

| Dimension | What It Measures |
|-----------|-----------------|
| **Clarity** | Instantly readable? Understood in 2 seconds? |
| **Texas-ness** | Genuinely Texas — not generic Americana |
| **Humor Punch** | Makes someone smirk or nod? |
| **Wearability** | Would real people wear this in public? |
| **Print Simplicity** | Screen-printable in 1–4 spot colors? |

Thresholds: **85+** = auto-approve · **65+** = review · **<50** = auto-reject

---

## Agents

| Agent | File | Purpose |
|-------|------|---------|
| Trend + Ideation | `prompts/cowork_*.txt` | Generate 10 concepts × 3 AI tools |
| Brand Guardian | `scoring.ts` | Filter + score all concepts |
| Design Brief Factory | `brief_factory.ts` | 2 variants × production specs |
| Shopify Listing | `orchestrator.ts` | SEO title, description, tags, collections |
| Marketing Agent | `email_automations.ts` | Email sequence, SMS, IG/TikTok copy |
| Analytics Agent | `analytics_ingest.ts` | Postmortem + feedback loop |
| Orchestrator | `orchestrator.ts` | State machine, human review gate |

---

## Adding Credentials

See `docs/API_KEYS.md`. Copy `.env.example` → `.env` and fill in values.

**Minimum for full draft run (no external APIs):** nothing required
**To publish to Shopify:** `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN`
**To schedule emails:** `KLAVIYO_PRIVATE_KEY` + list IDs

---

## Sample Drop Output (2025-W10)

Top finalists generated from sample inputs:

1. **"Runs On Brisket"** — Score 88 — food_bbq
2. **"Vaquero Strong"** — Score 86 — gym_cowboy_crossover
3. **"El Paso Is Closer To California"** — Score 84 — outsider_vs_texan
4. **"Sí Se Puede Brisket"** — Score 83 — tejano_cultural
5. **"Lone Star. No Notes."** — Score 82 — texas_pride_deadpan
6. **"Not From Here. Trying Though."** — Score 81 — outsider_vs_texan

See `drops/2025-W10/` for full sample output.

---

## Docs

- `docs/SETUP.md` — Installation guide
- `docs/OPERATIONS.md` — Weekly workflow
- `docs/API_KEYS.md` — API key sources
- `docs/RUNBOOK.md` — Failure modes
