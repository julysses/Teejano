# Deploying Teejano Agency Web App

The web dashboard runs as a Node.js server. Deploy it anywhere Node.js runs.

---

## Run Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

Set `PORT` env var to change the port (default: 3000).

---

## Option 1: Railway (Recommended — Free Tier Available)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Connect your repo
3. Railway auto-detects `railway.json` + `Procfile`
4. Add environment variables in Railway dashboard:
   ```
   SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
   KLAVIYO_PRIVATE_KEY=pk_...
   PORT=3000
   ```
5. Your app is live at `https://your-app.railway.app`

---

## Option 2: Render (Free Tier)

1. Go to [render.com](https://render.com) → New Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add environment variables in Render dashboard
5. Live at `https://your-app.onrender.com`

---

## Option 3: Heroku

```bash
heroku create teejano-agency
heroku config:set SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
heroku config:set SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
git push heroku main
heroku open
```

---

## Option 4: VPS / Server (DigitalOcean, Linode, etc.)

```bash
# On your server:
git clone <your-repo> /opt/teejano
cd /opt/teejano
npm install

# Create .env file
cp .env.example .env
nano .env   # fill in your keys

# Run with PM2 (keeps it alive)
npm install -g pm2
pm2 start "npm start" --name teejano-agency
pm2 save
pm2 startup
```

For HTTPS, put Nginx in front:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

---

## Option 5: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t teejano-agency .
docker run -p 3000:3000 \
  -e SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com \
  -e SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_... \
  teejano-agency
```

---

## Important Notes

- **Persistent storage:** Drop files are saved to disk. On Railway/Render free tiers, the filesystem resets on redeploy. Use a mounted volume or connect to a cloud storage service for persistence.
- **Security:** Add basic auth if you don't want the dashboard publicly accessible. The server has no auth by default.
- **Secrets:** Never commit `.env`. Always use environment variables on your deploy platform.

---

## Adding Basic Auth (Optional)

Install `express-basic-auth`:
```bash
npm install express-basic-auth @types/express-basic-auth
```

Add to `server/server.ts` before the routes:
```typescript
import basicAuth from 'express-basic-auth';
app.use(basicAuth({
  users: { 'teejano': process.env.DASHBOARD_PASSWORD ?? 'changeme' },
  challenge: true,
}));
```

Set `DASHBOARD_PASSWORD` env var on your deploy platform.
