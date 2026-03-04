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
    model: "gemini-2.0-flash",
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
