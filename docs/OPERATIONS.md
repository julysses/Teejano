# Teejano Agency — Weekly Operations Guide

## Weekly Drop Calendar (America/Chicago)

| Day | Task |
|-----|------|
| **Monday** | Run ideation — generate cowork prompts |
| **Tuesday** | Paste cowork responses back → scoring + brief generation |
| **Wednesday** | Review briefs, mockups, email teaser goes out |
| **Thursday** | Shopify staging review |
| **Friday** | Publish drop, email + SMS live |
| **Sunday** | Last call email + SMS |
| **Tuesday+1** | Analytics ingest + postmortem |

---

## Step-by-Step Weekly Workflow

### Step 1: Start the Drop (Monday)

```bash
npx ts-node scripts/run_weekly_drop.ts --week 2025-W01 --mode draft
```

This generates:
- `drops/2025-W01/COWORK/01_chatgpt_prompt.txt`
- `drops/2025-W01/COWORK/02_gemini_prompt.txt`
- `drops/2025-W01/COWORK/03_design_arena_prompt.txt`

### Step 2: Run Cowork Prompts (Monday/Tuesday)

1. Open `drops/2025-W01/COWORK/01_chatgpt_prompt.txt`
2. Paste into ChatGPT (GPT-4 or better)
3. Save the response to `drops/2025-W01/COWORK/inputs/chatgpt_response.txt`
4. Repeat for Gemini and Design Arena prompts

> **Important:** Responses must be valid JSON arrays. If the AI adds markdown fences (```json), that's fine — the parser handles it.

### Step 3: Continue Processing (Tuesday)

```bash
npx ts-node scripts/run_weekly_drop.ts --week 2025-W01 --mode draft
```

This now detects your inputs and:
- Parses + validates all cowork responses
- Scores concepts (0–100)
- Selects top 12 finalists with diversity enforcement
- Generates design briefs (2 variants per finalist)
- Generates Shopify listing copy
- Generates marketing pack (IG, TikTok, Email, SMS)
- Generates mockups (placeholder or ImageMagick composite)
- Creates `drops/2025-W01/APPROVAL.md`

### Step 4: Human Review (Tuesday/Wednesday)

Review these files:
- `drops/2025-W01/01_FINALISTS.md` — Top scoring concepts
- `drops/2025-W01/02_DESIGN_BRIEFS/` — Design briefs for each variant
- `drops/2025-W01/03_LISTINGS/` — Shopify listing copy
- `drops/2025-W01/04_MARKETING/` — Social + email copy
- `drops/2025-W01/05_MOCKUP_SHOTLIST.md` — Mockup production checklist
- `drops/2025-W01/APPROVAL.md` — Final approval checklist

Edit `APPROVAL.md`:
```
APPROVED=true   ← Change from false to true
```

### Step 5: Design Production (Wednesday/Thursday)

Use the design briefs to create actual files in Canva/Illustrator/Figma.
Save final designs to `drops/2025-W01/ASSETS/DESIGNS/`:
- `{CONCEPT_ID}_VA.png` — Variant A design
- `{CONCEPT_ID}_VB.png` — Variant B design

### Step 6: Publish (Friday)

```bash
npx ts-node scripts/run_weekly_drop.ts --week 2025-W01 --mode publish
```

This:
- Verifies `APPROVAL.md` is approved
- Pushes all products to Shopify as drafts (or live if autopublish=true)
- Schedules Klaviyo email sequence (if keys configured)
- Writes `drops/2025-W01/PUBLISH/publish_log.json`

### Step 7: Go Live (Friday Morning)

If using draft mode, manually publish in Shopify Admin:
1. Products → Filter by tag `drop-2025-w01`
2. Select all → Actions → Publish

### Step 8: Postmortem (Following Tuesday)

```bash
npx ts-node scripts/run_weekly_drop.ts --postmortem --week 2025-W01
```

Or using npm:
```bash
npm run postmortem -- --week 2025-W01
```

This:
- Pulls order data from Shopify
- Identifies winners/losers
- Updates `data/winner_patterns.md`
- Auto-adds losers to `data/blacklist_phrases.txt`
- Writes `drops/2025-W01/POSTMORTEM.md`

---

## Configuration Toggles

### Switch to Autopublish Mode
In `config/shopify_config.json`:
```json
{
  "draft_mode": false,
  "autopublish_mode": true
}
```

### Change Category Focus
In `config/teejano_rules.json`:
```json
{
  "default_category_focus": "texas_cities"
}
```

### Adjust Drop Size
In `config/teejano_rules.json`:
```json
{
  "cadence": {
    "designs_per_drop": [8, 12]
  }
}
```

---

## Data Flows

```
cowork_prompts/ → AI tools → cowork inputs/ → scoring.ts → finalists
finalists → brief_factory.ts → design_briefs/
finalists → orchestrator.ts → listings/ + marketing/
briefs → mockup_generator.ts → ASSETS/MOCKUPS/
listings + mockups → shopify_publisher.ts → Shopify
listings → email_automations.ts → Klaviyo / export pack
Shopify orders → analytics_ingest.ts → metrics_weekly.csv
metrics → feedback_loop → winner_patterns.md + blacklist → next week's scoring
```
