import type { LarkChannel } from '@larksuite/channel';
import { log } from '../core/logger';

export interface KnownChat {
  id: string;
  name: string;
}

export async function fetchKnownChats(channel: LarkChannel): Promise<KnownChat[]> {
  try {
    const summaries = await channel.listChats({ pageSize: 100, maxPages: 5 });
    const chats: KnownChat[] = summaries.map((c) => ({
      id: c.id,
      name: c.name || '(无名)',
    }));
    log.info('lark-info', 'chats-fetched', { count: chats.length });
    return chats;
  } catch (err) {
    log.warn('lark-info', 'chats-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Fetch a user's display name from Feishu Contact API.
 * Returns undefined on any error (caller should fall back to a safe default).
 * Requires the app to have `contact:user.base:readonly` or `contact:user` scope.
 */
export async function fetchUserName(opts: {
  appId: string;
  appSecret: string;
  domain: string;
  openId: string;
}): Promise<string | undefined> {
  try {
    const tokenResp = await fetch(`${opts.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: opts.appId, app_secret: opts.appSecret }),
    });
    if (!tokenResp.ok) return undefined;
    const tokenData = await tokenResp.json() as { code?: number; tenant_access_token?: string };
    if (tokenData.code !== 0 || !tokenData.tenant_access_token) return undefined;

    const userResp = await fetch(
      `${opts.domain}/open-apis/contact/v3/users/${opts.openId}?user_id_type=open_id`,
      {
        headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` },
      },
    );
    if (!userResp.ok) return undefined;
    const userData = await userResp.json() as { code?: number; data?: { user?: { name?: string } } };
    if (userData.code !== 0) return undefined;
    const name = userData.data?.user?.name?.trim();
    return name || undefined;
  } catch (err) {
    log.warn('lark-info', 'fetch-user-name-failed', {
      openId: opts.openId.slice(-6),
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
