import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { db } from "./db.js";
import { gemini, paceGeminiCall } from "./llm.js";
import type { ReportCard } from "./grade.js";

const REVIEWER_INSTRUCTIONS = `You review trades made by an automated trading agent, after the fact.
For each trade you get: what the agent did, its reason at the time, and what the price did over the next few trading days (which the agent could not see).
Write one plain sentence per trade (at most 25 words) that says whether the reasoning held up and what to learn from it.
Be specific to the trade. No hedging, no jargon, no emojis. Do not repeat the numbers you were given unless they make the point.`;

let reviewer: Agent | null = null;
function getReviewer(): Agent {
  reviewer ??= new Agent({ id: "provingground-reviewer", name: "ProvingGround reviewer", instructions: REVIEWER_INSTRUCTIONS, model: gemini() });
  return reviewer;
}

/**
 * Adds a one-line, after-the-fact review to every graded trade in a run, in a
 * single model call. Saves it as trades.ai_review and returns id -> review.
 * Failing here never fails the run: the rule-based explanation stays.
 */
export async function reviewTrades(card: ReportCard, opts: { aliases?: Record<string, string> } = {}): Promise<Record<number, string>> {
  const graded = card.trades.filter((t) => t.grade !== "ungraded");
  if (!graded.length) return {};

  const aliasNote = opts.aliases && Object.keys(opts.aliases).length
    ? `The agent saw a disguised market, so its reasons use these names: ${Object.entries(opts.aliases).map(([real, a]) => `${a} = ${real}`).join(", ")}.\n\n`
    : "";
  const list = graded.map((t) => ({
    id: t.id,
    action: `${t.side} ${t.ticker} at ${t.price.toFixed(2)} on ${t.filledOn}`,
    agentReason: (t.reason ?? "").slice(0, 300),
    after: `${card.horizonDays} trading days later: ${t.laterPrice?.toFixed(2)} (${((t.fwdReturn ?? 0) * 100).toFixed(1)}%)`,
    grade: t.grade,
  }));
  const prompt = `${aliasNote}Trades to review:\n${JSON.stringify(list, null, 1)}`;
  const schema = z.object({ reviews: z.array(z.object({ id: z.number().int(), review: z.string() })) });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await paceGeminiCall();
      const out = await getReviewer().generate(prompt, { structuredOutput: { schema } });
      const reviews = (out.object as z.infer<typeof schema> | undefined)?.reviews ?? [];
      const valid = new Set(graded.map((t) => t.id));
      const result: Record<number, string> = {};
      for (const r of reviews) {
        if (!valid.has(r.id) || !r.review?.trim()) continue;
        result[r.id] = r.review.trim().slice(0, 400);
        await db().query("UPDATE trades SET ai_review = $2 WHERE id = $1", [r.id, result[r.id]]);
      }
      return result;
    } catch {
      await new Promise((r) => setTimeout(r, [3000, 10000, 0][attempt]));
    }
  }
  return {};
}
