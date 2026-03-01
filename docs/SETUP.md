# Teejano Agency — Setup Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- (Optional) ImageMagick — for local mockup compositing
- (Optional) Shopify store with Admin API access
- (Optional) Klaviyo account

## 1. Install Dependencies

```bash
cd teejano-agency
npm install
```

## 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials (see `docs/API_KEYS.md` for where to get each key).

### Minimum required to run in draft mode (no external API calls):
```bash
# Nothing required — runs fully offline in draft mode
```

### To publish to Shopify:
```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
SHOPIFY_API_VERSION=2024-10
```

### To schedule emails via Klaviyo:
```bash
KLAVIYO_PRIVATE_KEY=pk_...
KLAVIYO_LIST_ID_ALL=XXXXXX
```

## 3. Add Mockup Blank Images

Place your blank shirt PNG files in `assets/mockups/blanks/`:
```
assets/mockups/blanks/
  bc3001_black_front.png     — Bella+Canvas 3001 Black front (2000×2000px)
  bc3001_white_front.png     — Bella+Canvas 3001 White front
  cc1717_pepper_front.png    — Comfort Colors 1717 Pepper front
  cc1717_ivory_front.png     — Comfort Colors 1717 Ivory front
  flatlay_black.png          — Black tee flatlay
```

Recommended sources:
- Printify mockup generator (download your blank templates)
- Placeit (purchase blank templates)
- Custom photography

> **Note:** If blanks are missing, the system generates placeholder images automatically.

## 4. Install ImageMagick (optional, recommended)

```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install imagemagick

# Windows
# Download from https://imagemagick.org/script/download.php
```

## 5. Shopify Collections Setup

Before publishing, create these collections in your Shopify admin:
- "General Texas Humor"
- "Weekly Drops"
- "Best Sellers"
- "New Arrivals"

## 6. Run Your First Drop (Draft Mode)

```bash
npm run drop:draft
# or with explicit week:
npx ts-node scripts/run_weekly_drop.ts --week 2024-W48 --mode draft
```

See `docs/OPERATIONS.md` for the full weekly workflow.
