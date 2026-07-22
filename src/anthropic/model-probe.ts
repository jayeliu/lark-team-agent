/**
 * Capability probe for models exposed by an Anthropic-compatible proxy.
 *
 * Since the /v1/models endpoint does not return capability fields, this module
 * tests each model against the three media endpoints and caches the results.
 *
 * Probe strategy (each request uses minimal parameters):
 *   chat:      POST /v1/chat/completions  max_tokens=1  → 200 or 400 with output-limit message = chat capable
 *   image-gen: POST /v1/images/generations n=1          → 200 = image capable
 *   video-gen: POST /v1/video/generations  duration=3   → 200 with task_id = video capable
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ModelCapability = 'chat' | 'image-gen' | 'video-gen';

export interface ModelCapabilityRecord {
  modelId: string;
  capabilities: ModelCapability[];
  probedAt: string;
}

export interface CapabilityCache {
  version: 1;
  probedAt: string;
  models: ModelCapabilityRecord[];
}

export interface ProbeOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Max concurrent probe requests. Default 16. */
  concurrency?: number;
  /** Per-request timeout ms. Default 15000. */
  timeoutMs?: number;
  /** Called after each model is probed. */
  onProgress?: (done: number, total: number, modelId: string) => void;
}

// ── Probe helpers ───────────────────────────────────────────────────────────

async function probeEndpoint(
  url: string,
  body: object,
  apiKey: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, body: data };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function isChatCapable(status: number, body: unknown): boolean {
  if (status === 200) return true;
  if (status !== 400) return false;
  const msg = (body as Record<string, unknown>)?.['error'] as Record<string, unknown> | undefined;
  const text = String(msg?.['message'] ?? '').toLowerCase();
  // 400 due to max_tokens/output limit means the model is chat-capable
  return text.includes('max_tokens') || text.includes('output limit') || text.includes('finish') || text.includes('maximum');
}

function isImageCapable(status: number, body: unknown): boolean {
  if (status === 200) return true;
  if (status !== 400) return false;
  // 400 with a size/param error means the model supports image generation
  // but doesn't accept the small probe size — still image-capable.
  const msg = (body as Record<string, unknown>)?.['error'] as Record<string, unknown> | undefined;
  const text = String(msg?.['message'] ?? '').toLowerCase();
  return text.includes('size') || text.includes('invalid_value') || text.includes('supported size');
}

function isVideoCapable(status: number, body: unknown): boolean {
  if (status !== 200) return false;
  // Video endpoint returns a task object
  const d = body as Record<string, unknown> | null;
  return !!(d?.['task_id'] || d?.['id']);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Probe all models for their capabilities.
 *
 * Strategy: run three separate parallel rounds (chat → image → video) instead
 * of probing all three endpoints per model simultaneously. This way the fast
 * chat round finishes first without being held back by slow media generation,
 * and each round's concurrency limit is independent.
 *
 *   Round 1 – chat:      all 121 models, ~15s timeout, completes in seconds
 *   Round 2 – image-gen: all 121 models, ~90s timeout, ~8 batches of 16
 *   Round 3 – video-gen: all 121 models, ~90s timeout, ~8 batches of 16
 *
 * Wall-clock ≈ chat_time + image_time + video_time  (vs. max(chat,img,vid) × batches before)
 */
export async function probeAllModels(
  modelIds: string[],
  opts: ProbeOptions = {},
): Promise<ModelCapabilityRecord[]> {
  const baseUrl = (opts.baseUrl ?? process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  const concurrency = opts.concurrency ?? 16;
  const chatTimeoutMs = opts.timeoutMs ?? 15_000;
  const mediaTimeoutMs = Math.max(chatTimeoutMs, 90_000);

  // Accumulate capabilities per modelId across all three rounds
  const capMap = new Map<string, Set<ModelCapability>>();
  for (const id of modelIds) capMap.set(id, new Set());

  let done = 0;

  async function runRound(
    endpoint: string,
    makeBody: (modelId: string) => object,
    judge: (status: number, body: unknown) => boolean,
    capability: ModelCapability,
    timeoutMs: number,
  ): Promise<void> {
    for (let i = 0; i < modelIds.length; i += concurrency) {
      const batch = modelIds.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (modelId) => {
          const res = await probeEndpoint(`${baseUrl}${endpoint}`, makeBody(modelId), apiKey, timeoutMs);
          if (judge(res.status, res.body)) capMap.get(modelId)!.add(capability);
          done++;
          opts.onProgress?.(done, modelIds.length * 3, modelId);
        }),
      );
    }
  }

  await runRound(
    '/v1/chat/completions',
    (id) => ({ model: id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    isChatCapable,
    'chat',
    chatTimeoutMs,
  );

  await runRound(
    '/v1/images/generations',
    (id) => ({ model: id, prompt: 'test', n: 1, size: '256x256' }),
    (status, body) => isImageCapable(status, body),
    'image-gen',
    mediaTimeoutMs,
  );

  await runRound(
    '/v1/video/generations',
    (id) => ({ model: id, prompt: 'test', duration: 3 }),
    isVideoCapable,
    'video-gen',
    mediaTimeoutMs,
  );

  return modelIds.map((modelId) => ({
    modelId,
    capabilities: [...capMap.get(modelId)!],
    probedAt: new Date().toISOString(),
  }));
}

// ── Cache I/O ────────────────────────────────────────────────────────────────

export async function loadCapabilityCache(cachePath: string): Promise<CapabilityCache | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const data = JSON.parse(raw) as CapabilityCache;
    if (data.version !== 1 || !Array.isArray(data.models)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveCapabilityCache(
  cachePath: string,
  records: ModelCapabilityRecord[],
): Promise<void> {
  const cache: CapabilityCache = {
    version: 1,
    probedAt: new Date().toISOString(),
    models: records,
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

export function getModelsWithCapability(
  cache: CapabilityCache,
  capability: ModelCapability,
): string[] {
  return cache.models
    .filter((m) => m.capabilities.includes(capability))
    .map((m) => m.modelId);
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Auto-refresh the capability cache if missing or older than 7 days.
 * Runs silently in the background — never throws, logs to stderr on error.
 * Call once after bridge connects; subsequent calls are no-ops if cache is fresh.
 */
export async function maybeRefreshCapabilityCache(
  cachePath: string,
  opts: ProbeOptions = {},
): Promise<void> {
  try {
    const existing = await loadCapabilityCache(cachePath);
    if (existing) {
      const age = Date.now() - new Date(existing.probedAt).getTime();
      if (age < CACHE_TTL_MS) return; // still fresh
    }

    const { fetchModels } = await import('./models.js');
    const listResult = await fetchModels({ baseUrl: opts.baseUrl, apiKey: opts.apiKey });
    if (!listResult.ok) return;

    const modelIds = listResult.models.map((m) => m.id);
    const records = await probeAllModels(modelIds, opts);
    await saveCapabilityCache(cachePath, records);
  } catch {
    // silently ignore — this is best-effort background work
  }
}
