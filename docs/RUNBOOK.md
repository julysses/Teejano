# Teejano Agency — Runbook (Failure Modes)

## Failure Modes & Recovery

---

### 1. Cowork inputs not parsing

**Symptom:** `Could not parse JSON from chatgpt_response.txt`

**Cause:** AI returned extra text outside the JSON array.

**Fix:**
1. Open the response file
2. Manually remove any text before `[` and after `]`
3. Ensure it's valid JSON: paste into `jsonlint.com`
4. Re-run the drop script

---

### 2. Zero concepts passing scoring

**Symptom:** `Finalists selected: 0`

**Cause:** All concepts hit hard disqualifiers or scored below threshold.

**Fix:**
1. Check `drops/{week}/LOGS/run.log` for rejection reasons
2. Check `data/blacklist_phrases.txt` — may be too aggressive
3. Lower threshold temporarily in `config/scoring_rubric.json`:
   ```json
   "review_required": 50
   ```
4. Re-run

---

### 3. Shopify API returns 401

**Symptom:** `Shopify API error: 401 Unauthorized`

**Cause:** Invalid or expired `SHOPIFY_ADMIN_ACCESS_TOKEN`.

**Fix:**
1. Go to Shopify Admin → Apps → Your app → Rotate token
2. Update `.env` with new token
3. Re-run with `--mode publish`

---

### 4. Shopify API returns 429 (rate limit)

**Symptom:** Slow publishing, some products fail

**Cause:** Shopify rate limiting (40 req/min standard, 80 req/min Shopify Plus)

**Fix:** Already handled automatically with exponential backoff. If persists:
1. Reduce `rate_limits.requests_per_second` in `config/shopify_config.json` to `1`
2. Re-run — the publisher skips already-created products

---

### 5. Klaviyo campaign creation fails

**Symptom:** `Klaviyo API error 422`

**Cause:** Invalid list ID or API key scope.

**Fix:**
1. Verify `KLAVIYO_LIST_ID_ALL` is correct (6-char alphanumeric)
2. Verify private key has campaign write permissions
3. Fallback: use `drops/{week}/04_MARKETING/email_sequence/IMPORT_INSTRUCTIONS.md`

---

### 6. ImageMagick not found / mockup generation fails

**Symptom:** `Mockup generation failed ... command not found: convert`

**Cause:** ImageMagick not installed.

**Fix:**
```bash
# macOS
brew install imagemagick

# Ubuntu
sudo apt-get install imagemagick
```

Or: The system automatically falls back to placeholder images. Drop still runs. Mockups will be blank-colored placeholders — replace with real mockups manually.

---

### 7. Drop already partially run

**Symptom:** Duplicate products or incomplete state.

**Fix:**
1. Check `drops/{week}/PUBLISH/publish_log.json` for what succeeded
2. For duplicate Shopify products: delete them manually in Shopify Admin
3. To fully restart a week: delete the `drops/{week}/` folder and re-run

---

### 8. Blacklist too aggressive

**Symptom:** Good concepts keep getting rejected.

**Fix:**
1. Open `data/blacklist_phrases.txt`
2. Comment out or remove the overly broad entries
3. Rebuild blacklist more precisely with specific phrases only

---

### 9. Postmortem shows no data

**Symptom:** Postmortem runs but shows no winners/losers.

**Cause:** Shopify API not configured, or no CSV data.

**Fix:**
1. Manually fill in `data/metrics_weekly.csv` with your order data
2. Re-run: `npm run postmortem -- --week 2025-W01`

---

## Emergency Procedures

### Skip human review gate
Only in emergencies (you've already manually reviewed everything):
```bash
# Edit drops/{week}/APPROVAL.md
APPROVED=true
```

### Disable Shopify publish entirely
Set in `config/shopify_config.json`:
```json
"draft_mode": true,
"autopublish_mode": false
```
Products will be created as DRAFT and never auto-published.

### Roll back a drop
1. In Shopify Admin: Products → filter by `drop-{week}` tag → Archive all
2. Send "Oops" email via Klaviyo or Shopify Email

---

## Log Locations
- Main run log: `drops/{week}/LOGS/run.log`
- Publish log: `drops/{week}/PUBLISH/publish_log.json`
- Metrics: `data/metrics_weekly.csv`
- Winner patterns: `data/winner_patterns.md`
- Blacklist: `data/blacklist_phrases.txt`
