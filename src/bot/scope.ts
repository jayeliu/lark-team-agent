import type { LarkChannel, NormalizedMessage } from '@larksuite/channel';
import type { ChatModeCache } from './chat-mode-cache';

/**
 * Compute the **session scope** for a message.
 *
 * Original behaviour (multiUser disabled):
 *  - p2p / group: scope = chatId
 *  - topic group: scope = `${chatId}:${threadId}`
 *
 * Multi-user behaviour (multiUser enabled):
 *  - p2p: scope = senderId  — each user gets their own session & workspace,
 *    keyed by their permanent Feishu open_id rather than the ephemeral chatId.
 *    This survives app reinstalls and device switches.
 *  - group / topic: unchanged — groups are shared sessions by design.
 *
 * Async because chat mode requires an API lookup (cached after first hit).
 */
export async function scopeFor(
  channel: LarkChannel,
  chatId: string,
  threadId: string | undefined,
  cache: ChatModeCache,
  opts?: { multiUser?: boolean; senderId?: string; chatType?: string },
): Promise<string> {
  const mode = await cache.resolve(channel, chatId);
  if (mode === 'topic' && threadId) {
    return `${chatId}:${threadId}`;
  }
  // Multi-user: p2p uses senderId so workspace maps to a stable personal dir
  if (opts?.multiUser && opts.chatType === 'p2p' && opts.senderId) {
    return opts.senderId;
  }
  return chatId;
}

/** Convenience overload from a NormalizedMessage. */
export async function scopeForMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
  cache: ChatModeCache,
  opts?: { multiUser?: boolean },
): Promise<string> {
  return scopeFor(channel, msg.chatId, msg.threadId, cache, {
    multiUser: opts?.multiUser,
    senderId: msg.senderId,
    chatType: msg.chatType,
  });
}
