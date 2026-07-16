/**
 * Builds a markdown message that prompts a user to complete OAuth authorization.
 * Uses plain markdown with a link instead of an interactive card -- interactive
 * cards with tag:action are rejected by Feishu API when processed as schema 2.0
 * (ErrCode 200861: unsupported tag action).
 */

export interface OAuthPromptCardOptions {
  verificationUrl: string;
  reason?: string;
  buttonText?: string;
  expiresInMinutes?: number;
}

/** Returns a markdown string suitable for channel.send(to, { markdown: ... }). */
export function buildOAuthPromptMarkdown(opts: OAuthPromptCardOptions): string {
  const {
    verificationUrl,
    reason = '需要授权才能以你的身份操作飞书文档和其他资源。',
    buttonText = '点此打开授权链接',
    expiresInMinutes,
  } = opts;

  const expireNote = expiresInMinutes
    ? '\n链接将在 **' + String(expiresInMinutes) + '** 分钟后失效。'
    : '';

  return [
    '🔐 **需要飞书授权**',
    '',
    reason,
    '',
    '[' + buttonText + '](' + verificationUrl + ')',
    '',
    '授权完成后，请返回原对话重新发送消息，即可继续。' + expireNote,
  ].join('\n');
}

/** @deprecated Use buildOAuthPromptMarkdown instead. */
export const buildOAuthPromptCard = buildOAuthPromptMarkdown;
