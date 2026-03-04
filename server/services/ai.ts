/**
 * ai.ts — Secure AI service for Teejano
 * Keys are read from environment variables only. Never exposed to the client.
 */

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey: key });
}

function getGemini(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey: key });
}

/** Call GPT-4o with the given prompt. Returns raw text response. */
export async function callGPT(prompt: string): Promise<string> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.9,
    max_tokens: 4096,
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("GPT returned an empty response");
  return text;
}

/** Call Gemini 2.0 Flash with the given prompt. Returns raw text response. */
export async function callGemini(prompt: string): Promise<string> {
  const genai = getGemini();
  const response = await genai.models.generateContent({
    model: "gemini-2.0-flash-001",
    contents: prompt,
  });
  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

/** Route a prompt to the right model based on source name. */
export async function callAI(
  source: "chatgpt" | "gemini" | "design_arena",
  prompt: string
): Promise<string> {
  if (source === "gemini") return callGemini(prompt);
  return callGPT(prompt); // chatgpt + design_arena both use GPT
}

/**
 * Ask GPT for current Texas-relevant trends for the given week.
 * Returns a short, actionable trend brief for injection into the design prompt.
 * Never throws — returns empty string on failure so the drop can still start.
 */
export async function fetchTrends(week: string, userHints: string = ""): Promise<string> {
  try {
    const hintsLine = userHints.trim()
      ? `\nAlso incorporate these hints from the brand owner: ${userHints.trim()}`
      : "";

    const prompt = `Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. The drop week is ${week}.

You are a trend researcher for TEEJANO, a Texas streetwear brand. In 8–12 punchy bullet points, list the most relevant cultural signals RIGHT NOW for Texas t-shirt design. Cover:

- Texas news or viral moments this week
- Texas sports (Cowboys, Texans, Spurs, Longhorns, Aggies, local teams)
- Upcoming Texas holidays or events in the next 3 weeks
- Texas weather patterns or memes circulating now
- Viral Texas humor or sayings trending on social media
- BBQ / food / truck culture moments
- Gym / fitness culture moments relevant to Texas
- Tejano / Mexican-American cultural moments${hintsLine}

Be specific and actionable — these will directly inform t-shirt phrases and visuals.
Format: one bullet per line, no headers, no explanation. Just the bullets.`;

    return await callGPT(prompt);
  } catch {
    return userHints.trim(); // fall back to user hints only
  }
}
