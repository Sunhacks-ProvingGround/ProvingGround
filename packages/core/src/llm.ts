/**
 * Default model. gemini-3.1-flash-lite remembers the 2020 crash but knows
 * nothing about mid-2026, which is what the demo and control windows need.
 * Override with GEMINI_MODEL in .env.
 */
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export function geminiModelId(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/**
 * Gemini through its OpenAI-compatible endpoint, in Mastra's own model
 * config format. The API key is sent as Authorization: Bearer.
 */
export function gemini(modelId = geminiModelId()) {
  return {
    providerId: "gemini",
    modelId,
    url: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.GEMINI_API_KEY || "missing-key",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;

/**
 * Gemini's free tier allows 15 requests a minute per model. Every Gemini call
 * in this process waits its turn here so a run never bursts into the limit.
 * Set GEMINI_MIN_INTERVAL_MS=0 on a paid key to go full speed.
 */
export async function paceGeminiCall(): Promise<void> {
  const gap = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 4200);
  const wait = lastCallAt + gap - Date.now();
  lastCallAt = Math.max(Date.now(), lastCallAt + gap);
  if (wait > 0) await sleep(wait);
}
