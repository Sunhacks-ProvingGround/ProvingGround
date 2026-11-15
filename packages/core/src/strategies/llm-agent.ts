import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { gemini, geminiModelId, paceGeminiCall } from "../llm.js";
import { BlindView, Disguise, NormalView, type AgentView } from "../agent-view.js";
import { BENCHMARK } from "../universe.js";
import type { Strategy, DecisionContext } from "../types.js";

export const PROMPT_VERSION = "v2";

const INSTRUCTIONS = `You are a portfolio manager running a small fund. Each trading day, after the market closes, you decide how much of the fund to hold in each stock from the next morning's open. Anything not in stocks is held as cash.

Rules:
- Weights are fractions of the whole fund, between 0 and 1. They must add up to at most 1. No short selling, no leverage.
- Every trade costs a 0.1% fee, so only change positions when you have a reason.
- You only know what is in today's briefing. Prices and posts end today.
- Investor posts are opinions from social media and are often noisy.

Answer with your target weights and a short reason (one or two sentences).`;

export interface LlmDecisionLog {
  day: string;
  shownAs: string;
  targets: Record<string, number>;
  reason: string;
  ms: number;
  error?: string;
}

export interface LlmAgentOptions {
  mode: "normal" | "blind";
  start: string;
  model?: string;
  /** Show investor posts (default true). Off = prices only. */
  includePosts?: boolean;
  /** The user's own strategy, in plain English (prompt models). */
  strategyPrompt?: string;
  /** Lessons from the model's practice run, carried into the test. */
  lessons?: string;
  /** Strategy id saved with the run (default "llm"). */
  id?: string;
  /** Extra settings saved with the run and covered by its hash. */
  extraParams?: Record<string, unknown>;
  /** Called after each decision, for progress output. */
  onDecision?: (log: LlmDecisionLog) => void;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


/**
 * The daily briefing: everything the agent knows on one day. Normal and blind
 * mode get exactly the same information, only named and dated differently.
 */
export async function agentBriefing(ctx: DecisionContext, v: AgentView, includePosts = true): Promise<string> {
  const names = v.tradeable();
  const desc = v.describe();
  const lines: string[] = [];
  lines.push(`Today: ${v.today()} (after the close).`);
  lines.push(`You may hold: ${names.map((n) => `${n} (${desc[n]})`).join(", ")}, and cash.`);
  lines.push(`Market benchmark (watch only): ${v.benchmark()} (${desc[v.benchmark()]}).`);
  lines.push("");
  lines.push(`Portfolio value: ${Math.round(ctx.portfolio.equity).toLocaleString("en-US")}`);
  const realToShown = Object.fromEntries(ctx.tradeable.map((t, i) => [t, names[i]]));
  const cashW = 1 - Object.values(ctx.portfolio.weights).reduce((s, w) => s + w, 0);
  lines.push(`Current weights: ${ctx.tradeable.map((t) => `${realToShown[t]} ${pct(ctx.portfolio.weights[t] ?? 0)}`).join(", ")}, cash ${pct(cashW)}`);
  lines.push("");
  for (const n of [...names, v.benchmark()]) {
    const bars = await v.getPrices(n, 20);
    lines.push(`${n} last ${bars.length} closes: ${bars.map((b) => `${b.date}: ${b.close}`).join(" | ")}`);
  }
  for (const n of includePosts ? names : []) {
    const posts = await v.getPosts(n, 3, 6);
    if (!posts.length) continue;
    lines.push("");
    lines.push(`Recent posts about ${n}:`);
    for (const p of posts) lines.push(`- [${p.date}${p.sentiment ? `, ${p.sentiment}` : ""}] ${p.text.replace(/\s+/g, " ").slice(0, 280)}`);
  }
  lines.push("");
  lines.push("Decide your target weights for tomorrow's open.");
  return lines.join("\n");
}

/**
 * The AI agent as a Strategy. Normal mode shows the real market; blind mode
 * shows the same market in disguise. Everything else (prompt, model,
 * schedule) is identical, so the difference in returns is the Leakage Gap.
 *
 * One model call per day with everything in the briefing. (Multi-step tool
 * calls through Gemini's OpenAI-compatible endpoint fail on Gemini 3 models,
 * which need "thought signatures" that endpoint drops.)
 */
export function llmAgent(opts: LlmAgentOptions): Strategy & { decisions: LlmDecisionLog[] } {
  const modelId = opts.model ?? geminiModelId();
  const includePosts = opts.includePosts ?? true;
  const decisions: LlmDecisionLog[] = [];
  let disguise: Disguise | null = null;

  const agent = new Agent({
    id: "provingground-trader",
    name: "ProvingGround trader",
    instructions: [
      INSTRUCTIONS,
      opts.strategyPrompt?.trim() ? `\nThe fund's strategy, written by its owner. Follow it:\n${opts.strategyPrompt.trim()}` : "",
      opts.lessons?.trim() ? `\nLessons from your practice period (apply them):\n${opts.lessons.trim()}` : "",
    ].join("\n"),
    model: gemini(modelId),
  });

  return {
    id: opts.id ?? "llm",
    params: { model: modelId, mode: opts.mode, posts: includePosts, promptVersion: PROMPT_VERSION, ...opts.extraParams },
    decisions,
    async decide(ctx) {
      if (opts.mode === "blind" && !disguise) {
        disguise = await Disguise.create(opts.start, ctx.tradeable, BENCHMARK);
      }
      const view: AgentView = opts.mode === "blind"
        ? new BlindView(ctx.view, ctx.tradeable, BENCHMARK, disguise!)
        : new NormalView(ctx.view, ctx.tradeable, BENCHMARK);
      const shown = view.tradeable();
      const schema = z.object({
        targets: z.object(Object.fromEntries(shown.map((n) => [n, z.number().min(0).max(1)]))),
        reason: z.string(),
      });

      const prompt = await agentBriefing(ctx, view, includePosts);
      const t0 = Date.now();
      let lastError = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await paceGeminiCall();
          const out = await agent.generate(prompt, { structuredOutput: { schema } });
          const obj = out.object as { targets: Record<string, number>; reason: string } | undefined;
          if (!obj?.targets) throw new Error("No decision in the model's answer");
          const targets = view.toRealTargets(obj.targets);
          const log: LlmDecisionLog = { day: ctx.day, shownAs: view.today(), targets, reason: obj.reason, ms: Date.now() - t0 };
          decisions.push(log);
          opts.onDecision?.(log);
          return { targets, reason: obj.reason };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // Rate limits and hiccups: back off and try again.
          await sleep([2000, 6000, 15000, 0][attempt]);
        }
      }
      // After repeated failures, hold the current positions rather than stop the run.
      const log: LlmDecisionLog = {
        day: ctx.day, shownAs: view.today(), targets: ctx.portfolio.weights,
        reason: "No decision (model error); holding.", ms: Date.now() - t0, error: lastError.slice(0, 300),
      };
      decisions.push(log);
      opts.onDecision?.(log);
      return null;
    },
  };
}
