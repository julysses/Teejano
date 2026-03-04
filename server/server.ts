/**
 * server.ts — Teejano Agency Web Server
 * Express server that exposes all pipeline functions as a REST API
 * and serves the web dashboard UI.
 */

import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { router as apiRouter } from "./routes/api";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "..", "public")));

// Serve drop assets (mockup images) as static files
app.use("/drops", express.static(path.join(process.cwd(), "drops")));

// All API routes
app.use("/api", apiRouter);

// Fallback: serve index.html for any unmatched route (SPA)
// Express 5 requires explicit wildcard syntax
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[SERVER ERROR]", err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n🤠 Teejano Agency running at http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api`);
  console.log(`   Press Ctrl+C to stop\n`);
  console.log(`[ENV CHECK] OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "SET" : "MISSING"}`);
  console.log(`[ENV CHECK] GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? "SET" : "MISSING"}`);
  console.log(`[ENV CHECK] SHOPIFY_SHOP_DOMAIN: ${process.env.SHOPIFY_SHOP_DOMAIN ? "SET" : "MISSING"}`);
});

export default app;
