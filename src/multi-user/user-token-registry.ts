/**
 * Per-user OAuth token registry for lark-cli.
 *
 * Each Feishu user (identified by open_id / senderId) gets an isolated
 * lark-cli config directory under `<profileDir>/user-tokens/<senderId>/lark-cli/`.
 * This lets every user authorize with their own Feishu identity independently.
 *
 * Lifecycle:
 *   1. `needsAuth(senderId)` — true when the user has no stored token yet.
 *   2. `startAuth(senderId)` — allocates the per-user dir, spawns a background
 *      `lark-cli auth login --device-code` process, returns the verification URL.
 *   3. `waitForAuth(senderId)` — resolves when the background process completes
 *      (user finished the browser flow), rejects on timeout or failure.
 *   4. `getLarkCliConfigDir(senderId)` — returns the path to inject as
 *      `LARKSUITE_CLI_CONFIG_DIR` when launching the agent subprocess.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

const execFileAsync = promisify(execFile);

/** Seconds to wait for the user to complete the browser OAuth flow. */
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type TokenStatus = 'none' | 'pending' | 'ready';

interface UserTokenRecord {
  openId: string;
  larkCliConfigDir: string;
  status: TokenStatus;
  initiatedAt?: string;
  readyAt?: string;
}

type RegistryData = Record<string, UserTokenRecord>;

export interface UserTokenRegistryOptions {
  /** Directory where per-user token dirs are stored (e.g. `<profileDir>/user-tokens`). */
  baseDir: string;
  /** Environment variables required to invoke lark-cli in the bridge context. */
  larkEnv: Record<string, string>;
  /** Path to the registry JSON file. Defaults to `<baseDir>/registry.json`. */
  registryFile?: string;
  /** Timeout (ms) for the browser OAuth flow. Defaults to 10 min. */
  authTimeoutMs?: number;
}

export class UserTokenRegistry {
  private data: RegistryData = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly baseDir: string;
  private readonly registryFile: string;
  private readonly larkEnv: Record<string, string>;
  private readonly authTimeoutMs: number;

  /** Active `--device-code` auth waiters keyed by senderId. */
  private readonly authWaiters = new Map<string, Promise<void>>();

  constructor(opts: UserTokenRegistryOptions) {
    this.baseDir = opts.baseDir;
    this.registryFile = opts.registryFile ?? join(opts.baseDir, 'registry.json');
    this.larkEnv = opts.larkEnv;
    this.authTimeoutMs = opts.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.registryFile, 'utf8');
      this.data = JSON.parse(text) as RegistryData;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /** True when the user has no OAuth token yet (status is 'none' or missing). */
  needsAuth(senderId: string): boolean {
    return this.data[senderId]?.status !== 'ready';
  }

  /** True when a device-code auth flow is already in progress for this user. */
  isPending(senderId: string): boolean {
    return this.data[senderId]?.status === 'pending';
  }

  /** Returns the per-user lark-cli config directory, or undefined if not yet created. */
  getLarkCliConfigDir(senderId: string): string | undefined {
    const rec = this.data[senderId];
    if (!rec || rec.status !== 'ready') return undefined;
    return rec.larkCliConfigDir;
  }

  /**
   * Start a new device-code auth flow for the given user.
   *
   * Runs `lark-cli auth login --no-wait --json` to get a verification URL,
   * then spawns a background `--device-code` waiter that completes when the
   * user finishes the browser flow.
   *
   * Returns the verification URL the caller should surface to the user.
   *
   * Throws if lark-cli is unavailable or the device-code request fails.
   */
  async startAuth(
    senderId: string,
    opts: {
      appId: string;
      brand?: string;
      scope?: string;
      /** Extra lark-cli args such as --domain or --recommend. */
      extraArgs?: string[];
    },
  ): Promise<{ verificationUrl: string; expiresIn?: number }> {
    const configDir = this.ensureUserDir(senderId);
    await mkdir(join(configDir, 'lark-channel'), { recursive: true });

    // Merge bridge env + per-user config dir override
    const env: Record<string, string> = {
      ...this.larkEnv,
      LARKSUITE_CLI_CONFIG_DIR: configDir,
    };

    // Bind lark-cli to this user's config dir first
    try {
      await execFileAsync(
        'lark-cli',
        [
          'config', 'bind',
          '--source', 'lark-channel',
          '--identity', 'user-default',
          '--app-id', opts.appId,
          ...(opts.brand ? ['--brand', opts.brand] : []),
        ],
        { env: env as NodeJS.ProcessEnv },
      );
    } catch (err) {
      log.warn('user-token-registry', 'bind-failed', {
        senderId: senderId.slice(-6),
        err: String(err),
      });
      // Non-fatal: lark-cli may already be bound in this dir
    }

    // Request device code (returns immediately)
    const noWaitArgs = [
      'auth', 'login',
      '--no-wait',
      '--json',
      ...(opts.scope ? ['--scope', opts.scope] : []),
      ...(opts.extraArgs ?? []),
    ];

    let deviceOutput: string;
    try {
      const { stdout } = await execFileAsync('lark-cli', noWaitArgs, {
        env: env as NodeJS.ProcessEnv,
      });
      deviceOutput = stdout;
    } catch (err) {
      throw new Error(`lark-cli auth login --no-wait failed: ${String(err)}`);
    }

    let parsed: { verification_url?: string; device_code?: string; expires_in?: number };
    try {
      parsed = JSON.parse(deviceOutput) as typeof parsed;
    } catch {
      throw new Error(`lark-cli auth login returned non-JSON output: ${deviceOutput.slice(0, 200)}`);
    }

    const { verification_url: verificationUrl, device_code: deviceCode, expires_in: expiresIn } = parsed;
    if (!verificationUrl || !deviceCode) {
      throw new Error(`lark-cli auth login output missing fields: ${deviceOutput.slice(0, 200)}`);
    }

    // Mark as pending
    this.data[senderId] = {
      openId: senderId,
      larkCliConfigDir: configDir,
      status: 'pending',
      initiatedAt: new Date().toISOString(),
    };
    this.schedulePersist();

    // Spawn the blocking device-code waiter in the background
    this.authWaiters.set(
      senderId,
      this.runDeviceCodeWaiter(senderId, deviceCode, configDir, env).finally(() => {
        this.authWaiters.delete(senderId);
      }),
    );

    log.info('user-token-registry', 'auth-started', {
      senderId: senderId.slice(-6),
      configDir,
    });

    return { verificationUrl, expiresIn };
  }

  /**
   * Waits for the auth flow initiated by `startAuth` to complete.
   * Resolves when the token is saved; rejects on timeout or failure.
   */
  async waitForAuth(senderId: string): Promise<void> {
    const waiter = this.authWaiters.get(senderId);
    if (!waiter) {
      if (this.data[senderId]?.status === 'ready') return;
      throw new Error(`no pending auth for senderId ${senderId.slice(-6)}`);
    }
    return waiter;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private ensureUserDir(senderId: string): string {
    // Use the existing record's dir if already created, otherwise allocate a new one.
    const existing = this.data[senderId]?.larkCliConfigDir;
    if (existing) return existing;
    // Sanitize senderId for use as a directory name
    const safeName = senderId.replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.baseDir, safeName, 'lark-cli');
  }

  private runDeviceCodeWaiter(
    senderId: string,
    deviceCode: string,
    configDir: string,
    env: Record<string, string>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log.warn('user-token-registry', 'auth-timeout', { senderId: senderId.slice(-6) });
        this.data[senderId] = {
          ...this.data[senderId]!,
          status: 'none',
        };
        this.schedulePersist();
        reject(new Error('OAuth authorization timed out'));
      }, this.authTimeoutMs);

      execFile(
        'lark-cli',
        ['auth', 'login', '--device-code', deviceCode],
        { env: env as NodeJS.ProcessEnv },
        (err) => {
          clearTimeout(timeout);
          if (err) {
            log.warn('user-token-registry', 'auth-failed', {
              senderId: senderId.slice(-6),
              err: String(err),
            });
            this.data[senderId] = {
              ...this.data[senderId]!,
              status: 'none',
            };
            this.schedulePersist();
            reject(err);
            return;
          }

          // Apply identity policy: strict-mode off + default-as auto
          void this.applyIdentityPolicy(configDir, env).catch((policyErr) => {
            log.warn('user-token-registry', 'identity-policy-failed', {
              senderId: senderId.slice(-6),
              err: String(policyErr),
            });
          });

          this.data[senderId] = {
            ...this.data[senderId]!,
            status: 'ready',
            readyAt: new Date().toISOString(),
          };
          this.schedulePersist();
          log.info('user-token-registry', 'auth-ready', { senderId: senderId.slice(-6) });
          resolve();
        },
      );
    });
  }

  private async applyIdentityPolicy(configDir: string, env: Record<string, string>): Promise<void> {
    const e = { ...env, LARKSUITE_CLI_CONFIG_DIR: configDir } as NodeJS.ProcessEnv;
    await execFileAsync('lark-cli', ['config', 'strict-mode', 'off'], { env: e });
    await execFileAsync('lark-cli', ['config', 'default-as', 'auto'], { env: e });
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await mkdir(this.baseDir, { recursive: true });
        await writeFileAtomic(this.registryFile, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('user-token-registry', err, { step: 'persist' });
      });
  }
}
