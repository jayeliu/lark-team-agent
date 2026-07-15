import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';
import { nameToPinyinDir, uniqueDirName } from './pinyin-dir';
import { renderClaudeMd, renderUserMd } from './templates';

export interface UserRecord {
  openId: string;
  name: string;
  pinyinDir: string;
  workspace: string;
  registeredAt: string;
}

type UserMap = Record<string, UserRecord>;

export class UserRegistry {
  private data: UserMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;
  private readonly workspaceRoot: string;
  /** H3: prevent concurrent double-registration for the same senderId */
  private readonly inflight = new Map<string, Promise<UserRecord>>();

  constructor(registryPath: string, workspaceRoot: string) {
    this.path = registryPath;
    this.workspaceRoot = workspaceRoot;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      this.data = JSON.parse(text) as UserMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  get(openId: string): UserRecord | undefined {
    return this.data[openId];
  }

  list(): UserRecord[] {
    return Object.values(this.data);
  }

  /**
   * Register a new user: create workspace dirs, write CLAUDE.md and user.md,
   * persist to users.json. Returns the new record.
   * Concurrent calls for the same openId share the same in-flight promise.
   */
  async register(openId: string, name: string): Promise<UserRecord> {
    // H3: return existing record if already registered (race with a concurrent call)
    const alreadyDone = this.data[openId];
    if (alreadyDone) return alreadyDone;

    const pending = this.inflight.get(openId);
    if (pending) return pending;

    const work = this._doRegister(openId, name).finally(() => {
      this.inflight.delete(openId);
    });
    this.inflight.set(openId, work);
    return work;
  }

  private async _doRegister(openId: string, name: string): Promise<UserRecord> {
    const existing = new Set(Object.values(this.data).map((u) => u.pinyinDir));
    const base = nameToPinyinDir(name);
    const pinyinDir = uniqueDirName(base, existing);
    const workspace = join(this.workspaceRoot, pinyinDir);
    const registeredAt = new Date().toISOString();

    // Create directory structure
    await mkdir(join(workspace, 'CC-Memory'), { recursive: true });
    await mkdir(join(workspace, 'projects'), { recursive: true });

    const vars = { name, openId, pinyinDir, registeredAt, workspaceRoot: this.workspaceRoot };

    await writeFile(join(workspace, 'CLAUDE.md'), renderClaudeMd(vars), 'utf8');
    await writeFile(join(workspace, 'user.md'), renderUserMd(vars), 'utf8');

    const record: UserRecord = { openId, name, pinyinDir, workspace, registeredAt };
    this.data[openId] = record;
    this.schedulePersist();

    log.info('multi-user', 'registered', { openId, pinyinDir, workspace });
    return record;
  }

  /**
   * Ensure workspace dir still exists (e.g. after volume remount).
   * Re-creates missing dirs without overwriting existing files.
   */
  async ensureWorkspace(record: UserRecord): Promise<void> {
    try {
      await stat(record.workspace);
    } catch {
      log.warn('multi-user', 'workspace-missing', { workspace: record.workspace });
      await mkdir(join(record.workspace, 'CC-Memory'), { recursive: true });
      await mkdir(join(record.workspace, 'projects'), { recursive: true });
    }
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('multi-user', err, { step: 'persist-registry' });
      });
  }
}
