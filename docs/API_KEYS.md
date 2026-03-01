# API Keys Guide

## Shopify Admin API

1. Go to your Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Create a new app: "Teejano Agency"
3. Under "Configuration" → Admin API access scopes, enable:
   - `write_products`, `read_products`
   - `write_collections`, `read_collections`
   - `read_orders`
   - `write_metafields`, `read_metafields`
4. Install the app → copy the **Admin API access token**
5. Your shop domain is `your-store.myshopify.com`
6. API version: use `2024-10` (or latest stable)

```env
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxx
SHOPIFY_API_VERSION=2024-10
```

---

## Klaviyo

1. Log in to Klaviyo → Account → Settings → API Keys
2. Create a **Private API Key** with full access
3. Get your List IDs from Audience → Lists & Segments (click a list → URL contains the ID)

```env
KLAVIYO_PRIVATE_KEY=pk_xxxxxxxxxx
KLAVIYO_LIST_ID_ALL=XXXXXX
KLAVIYO_LIST_ID_ENGAGED=XXXXXX
```

---

## Canva API (optional)

1. Go to developers.canva.com
2. Create an app → get your API key
3. Note: Canva API is in limited access. LocalCompositeAdapter is the default.

```env
CANVA_API_KEY=your_canva_key
```

---

## Printify (optional)

1. Log in to Printify → My Account → Connections → API
2. Generate a Personal Access Token

```env
PRINTIFY_API_TOKEN=your_token
```

---

## Postscript SMS (optional)

1. Log in to Postscript → Settings → API
2. Copy your API key

```env
POSTSCRIPT_API_KEY=your_key
```

---

> **Security:** Never commit `.env` to git. Always use environment variables.
> The `.gitignore` already excludes `.env`.
