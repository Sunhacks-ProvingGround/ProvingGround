import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WINDOWS, listModels, getModel, createModel, updateModel, CODE_TEMPLATES, MODEL_FORMAT_DOC, PROMPT_EXAMPLE, PRACTICE_DAYS, MIN_TRAIN_DAYS, type RunRequest, type ModelInput } from "@pg/core";
import { createJob, createTrainJob, getJob, listJobs } from "./jobs.js";
import { agentPreview, getRun, listRuns, meta, overview, verify, tickers, modelRuns } from "./queries.js";

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const api = new Hono();

api.get("/health", (c) => c.json({ ok: true }));
api.get("/meta", (c) => c.json(meta()));

api.get("/overview", async (c) => {
  const w = c.req.query("window") ?? "demo";
  if (!(w in WINDOWS)) return c.json({ error: `Unknown window "${w}"` }, 400);
  return c.json(await overview(w as keyof typeof WINDOWS));
});

api.get("/runs", async (c) => c.json({ runs: await listRuns(), active: listJobs() }));

api.get("/runs/:id", async (c) => {
  const run = await getRun(c.req.param("id"));
  return run ? c.json(run) : c.json({ error: "Run not found" }, 404);
});

api.get("/verify", async (c) => c.json(await verify()));

api.get("/agent-preview", async (c) => {
  const w = c.req.query("window") ?? "demo";
  if (!(w in WINDOWS)) return c.json({ error: `Unknown window "${w}"` }, 400);
  try {
    return c.json(await agentPreview(c.req.query("day") ?? WINDOWS[w as keyof typeof WINDOWS].start, w as keyof typeof WINDOWS));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

/** Start a run. Returns a job id; follow it with GET /api/jobs/:id/stream. */
api.post("/runs", async (c) => {
  let body: RunRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Send a JSON body" }, 400);
  }
  try {
    const job = createJob(body);
    return c.json({ jobId: job.id, status: job.status }, 202);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

api.get("/tickers", async (c) => c.json({ tickers: await tickers() }));

api.get("/templates", (c) => c.json({ code: CODE_TEMPLATES, formatDoc: MODEL_FORMAT_DOC, promptExample: PROMPT_EXAMPLE, practiceDays: PRACTICE_DAYS, minTrainDays: MIN_TRAIN_DAYS, customCode: process.env.CUSTOM_CODE !== "off" }));

const modelSummary = ({ code, prompt, state, logs, ...m }: any) => ({ ...m, metrics: m.metrics ? { ...m.metrics, curve: undefined } : null });

api.get("/models", async (c) => c.json({ models: (await listModels()).map(modelSummary) }));

api.post("/models", async (c) => {
  try {
    return c.json(await createModel((await c.req.json()) as ModelInput), 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

api.get("/models/:id", async (c) => {
  const m = await getModel(c.req.param("id"));
  if (!m) return c.json({ error: "Model not found" }, 404);
  const active = listJobs().find((j) => j.task.kind === "train" && j.task.modelId === m.id);
  return c.json({ model: m, tests: await modelRuns(m.id), trainJobId: active?.id ?? null });
});

api.put("/models/:id", async (c) => {
  try {
    return c.json(await updateModel(c.req.param("id"), (await c.req.json()) as ModelInput));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

/** Train a model. Returns a job id; follow it with GET /api/jobs/:id/stream. */
api.post("/models/:id/train", async (c) => {
  const m = await getModel(c.req.param("id"));
  if (!m) return c.json({ error: "Model not found" }, 404);
  const job = createTrainJob(m.id);
  return c.json({ jobId: job.id, status: job.status }, 202);
});

/** Live progress of a started run or training job, as server-sent events. Replays what already happened. */
api.get("/jobs/:id/stream", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);
  return streamSSE(c, async (stream) => {
    const send = (e: unknown) => stream.writeSSE({ data: JSON.stringify(e) });
    await send({ type: "status", status: job.status });
    for (const e of job.events) await send(e);
    if (job.status === "done" || job.status === "failed") return;

    await new Promise<void>((resolveDone) => {
      // Send events in order, and close only after the final status has gone out.
      let chain = Promise.resolve();
      const listener = (e: any) => {
        chain = chain.then(() => send(e)).catch(() => {});
        if (e.type === "status" && (e.status === "done" || e.status === "failed")) chain.then(finish);
      };
      const finish = () => {
        job.listeners.delete(listener);
        clearInterval(ping);
        resolveDone();
      };
      // Keep proxies from closing an idle connection during slow model calls.
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 15000);
      job.listeners.add(listener);
      stream.onAbort(finish);
    });
  });
});

app.route("/api", api);

// Serve the built UI (apps/web/dist) from the same server, so it deploys as one app.
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ProvingGround API on http://localhost:${info.port}${existsSync(webDist) ? " (serving the UI too)" : ""}`);
});
