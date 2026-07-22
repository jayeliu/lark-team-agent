/**
 * API key pool for automatic failover when a key hits its daily quota.
 *
 * Keys are loaded from:
 *   ANTHROPIC_API_KEY        — primary key (always first in the pool)
 *   ANTHROPIC_API_KEY_POOL   — comma-separated backup keys
 *
 * When a quota error is detected the pool advances to the next key and
 * updates process.env['ANTHROPIC_API_KEY'] so all subsequent claude
 * subprocesses inherit the new key automatically.
 */

import { log } from '../core/logger';

/** Returns true when the stderr line indicates a quota/auth failure that
 *  warrants trying the next key. */
export function isQuotaError(line: string): boolean {
  return (
    /token quota is not enough/i.test(line) ||
    /quota.*not enough/i.test(line) ||
    /Failed to authenticate.*403/i.test(line) ||
    /API Error.*403/i.test(line)
  );
}

class KeyPool {
  private keys: string[] = [];
  private index = 0;

  constructor() {
    this.reload();
  }

  reload(): void {
    const primary = process.env['ANTHROPIC_API_KEY'] ?? '';
    const pool = (process.env['ANTHROPIC_API_KEY_POOL'] ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    // Deduplicate: primary first, then pool entries not equal to primary
    const all = [primary, ...pool.filter((k) => k !== primary)].filter(Boolean);
    if (all.length === 0) return;

    // If the current key is already in the new list, preserve position
    const current = this.keys[this.index];
    this.keys = all;
    const existingIdx = current ? this.keys.indexOf(current) : -1;
    this.index = existingIdx >= 0 ? existingIdx : 0;
  }

  get current(): string {
    return this.keys[this.index] ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  get size(): number {
    return this.keys.length;
  }

  /**
   * Rotate to the next available key.
   * Returns true if a new key was applied; false if the pool is exhausted.
   */
  rotate(exhaustedKey: string): boolean {
    if (this.keys.length <= 1) return false;

    const exhaustedIdx = this.keys.indexOf(exhaustedKey);
    const nextIdx = exhaustedIdx >= 0
      ? (exhaustedIdx + 1) % this.keys.length
      : (this.index + 1) % this.keys.length;

    if (nextIdx === (exhaustedIdx >= 0 ? exhaustedIdx : this.index)) {
      // Wrapped around — all keys tried
      return false;
    }

    this.index = nextIdx;
    process.env['ANTHROPIC_API_KEY'] = this.keys[this.index]!;

    log.info('key-pool', 'rotated', {
      from: exhaustedKey.slice(-6),
      to: (this.keys[this.index] ?? '').slice(-6),
      poolSize: this.keys.length,
      newIndex: this.index,
    });
    return true;
  }
}

export const keyPool = new KeyPool();
