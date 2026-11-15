import { randomUUID } from "node:crypto";
import { executeRun, normalizeRequest, trainModel, type RunRequest } from "@pg/core";

/**
 * Long tasks started from the UI: test runs and model training. They execute
 * one at a time (Gemini's rate limit is per key), and every event is kept so
 * a page that connects late still sees everything so far.
 */
type Task = { kind: "run"; request: RunRequest } | { kind: "train"; modelId: string };
type Listener = (e: any) => void;

export interface Job {
  id: string;
  task: Task;
  status: "queued" | "running" | "done" | "failed";
  runId?: string;
  seq?: number;
  error?: string;
  createdAt: string;
  events: any[];
  listeners: Set<Listener>;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let busy = false;

function enqueue(task: Task): Job {
  const job: Job = { id: randomUUID(), task, status: "queued", createdAt: new Date().toISOString(), events: [], listeners: new Set() };
  jobs.set(job.id, job);
  queue.push(job);
  void pump();
  return job;
}

export function createJob(request: RunRequest): Job {
  normalizeRequest(request); // throws a readable error for bad input
  return enqueue({ kind: "run", request });
}

export function createTrainJob(modelId: string): Job {
  const active = [...jobs.values()].find((j) => j.task.kind === "train" && j.task.modelId === modelId && (j.status === "queued" || j.status === "running"));
  return active ?? enqueue({ kind: "train", modelId });
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs() {
  return [...jobs.values()]
    .filter((j) => j.status === "queued" || j.status === "running")
    .map(({ events, listeners, ...rest }) => rest);
}

function setStatus(job: Job, status: Job["status"]) {
  job.status = status;
  for (const l of job.listeners) l({ type: "status", status });
}

function push(job: Job, e: any) {
  job.events.push(e);
  if (job.events.length > 2000) job.events.splice(0, job.events.length - 2000);
  for (const l of job.listeners) l(e);
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  setStatus(job, "running");
  try {
    if (job.task.kind === "run") {
      await executeRun(job.task.request, (e) => {
        if (e.type === "registered") { job.runId = e.runId; job.seq = e.seq; }
        if (e.type === "failed") job.error = e.error;
        push(job, e);
      });
    } else {
      await trainModel(job.task.modelId, (e) => {
        if (e.type === "train-failed") job.error = e.error;
        push(job, e);
      });
    }
    setStatus(job, "done");
  } catch (err) {
    job.error ??= err instanceof Error ? err.message : String(err);
    if (!job.events.some((e) => e.type === "failed" || e.type === "train-failed")) push(job, { type: "failed", error: job.error });
    setStatus(job, "failed");
  } finally {
    busy = false;
    void pump();
  }
}
