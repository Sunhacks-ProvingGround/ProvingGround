import { randomUUID } from "node:crypto";
import { executeRun, normalizeRequest, type RunEvent, type RunRequest } from "@pg/core";

/**
 * Runs started from the UI. They execute one at a time (Gemini's rate limit
 * is per key, and runs are quick for the baselines), and every event is kept
 * so a page that connects late still sees the whole run so far.
 */
export interface Job {
  id: string;
  request: RunRequest;
  status: "queued" | "running" | "done" | "failed";
  runId?: string;
  seq?: number;
  error?: string;
  createdAt: string;
  events: RunEvent[];
  listeners: Set<(e: RunEvent | { type: "status"; status: Job["status"] }) => void>;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let busy = false;

export function createJob(request: RunRequest): Job {
  normalizeRequest(request); // throws a readable error for bad input
  const job: Job = {
    id: randomUUID(),
    request,
    status: "queued",
    createdAt: new Date().toISOString(),
    events: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  void pump();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Omit<Job, "events" | "listeners">[] {
  return [...jobs.values()]
    .filter((j) => j.status === "queued" || j.status === "running")
    .map(({ events, listeners, ...rest }) => rest);
}

function setStatus(job: Job, status: Job["status"]) {
  job.status = status;
  for (const l of job.listeners) l({ type: "status", status });
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  setStatus(job, "running");
  try {
    await executeRun(job.request, (e) => {
      if (e.type === "registered") {
        job.runId = e.runId;
        job.seq = e.seq;
      }
      if (e.type === "failed") job.error = e.error;
      job.events.push(e);
      for (const l of job.listeners) l(e);
    });
    setStatus(job, "done");
  } catch (err) {
    job.error ??= err instanceof Error ? err.message : String(err);
    setStatus(job, "failed");
  } finally {
    busy = false;
    void pump();
  }
}
