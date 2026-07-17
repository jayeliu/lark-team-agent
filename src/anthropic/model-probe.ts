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

function isImageCapable(status: number): boolean {
  return status === 200;
}

function isVideoCapable(status: number, body: unknown): boolean {
  if (status !== 200) return false;
  // Video endpoint returns a task object
  const d = body as Record<string, unknown> | null;
  return !!(d?.['task_id'] || d?.['id']);
}

async function probeModel(
  modelId: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<ModelCapability[]> {
  const capabilities: ModelCapability[] = [];

  const [chatRes, imgRes, vidRes] = await Promise.all([
    probeEndpoint(
      `${baseUrl}/v1/chat/completions`,
      { model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
      apiKey,
      timeoutMs,
    ),
    probeEndpoint(
      `${baseUrl}/v1/images/generations`,
      { model: modelId, prompt: 'test', n: 1 },
      apiKey,
      timeoutMs,
    ),
    probeEndpoint(
      `${baseUrl}/v1/video/generations`,
      { model: modelId, prompt: 'test', duration: 3 },
      apiKey,
      timeoutMs,
    ),
  ]);

  if (isChatCapable(chatRes.status, chatRes.body)) capabilities.push('chat');
  if (isImageCapable(imgRes.status)) capabilities.push('image-gen');
  if (isVideoCapable(vidRes.status, vidRes.body)) capabilities.push('video-gen');

  return capabilities;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function probeAllModels(
  modelIds: string[],
  opts: ProbeOptions = {},
): Promise<ModelCapabilityRecord[]> {
  const baseUrl = (opts.baseUrl ?? process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  const concurrency = opts.concurrency ?? 16;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const results: ModelCapabilityRecord[] = [];
  let done = 0;

  // Process in batches to respect concurrency limit
  for (let i = 0; i < modelIds.length; i += concurrency) {
    const batch = modelIds.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (modelId) => {
        const capabilities = await probeModel(modelId, baseUrl, apiKey, timeoutMs);
        done++;
        opts.onProgress?.(done, modelIds.length, modelId);
        return {
          modelId,
          capabilities,
          probedAt: new Date().toISOString(),
        };
      }),
    );
    results.push(...batchResults);
  }

  return results;
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
