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

// All API routes
app.use("/api", apiRouter);

// Fallback: serve index.html for any unmatched route (SPA)
app.get("*", (_req, res) => {
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
});

export default app;
