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
