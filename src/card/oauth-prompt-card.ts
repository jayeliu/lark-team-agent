/**
 * Feishu interactive card that prompts a user to complete OAuth authorization.
 *
 * The card contains an external-link button pointing to the device-flow
 * `verification_url`. No callback is required — the user clicks the link,
 * finishes the browser flow, then returns to the chat and resends their message.
 *
 * This is intentionally generic: it has no hard-coded user IDs, app IDs, or
 * business logic. Callers supply all dynamic content through `OAuthPromptCardOptions`.
 */

export interface OAuthPromptCardOptions {
  /** The URL the user must open to complete OAuth (device flow `verification_url`). */
  verificationUrl: string;
  /**
   * Short description of why authorization is needed, shown as the card subtitle.
   * Defaults to "需要授权才能以你的身份操作飞书文档和其他资源。"
   */
  reason?: string;
  /**
   * Label on the open-link button.
   * Defaults to "打开授权链接".
   */
  buttonText?: string;
  /**
   * Minutes until the device code expires.
   * When provided, a note is appended: "链接将在 N 分钟后失效。"
   */
  expiresInMinutes?: number;
}

/**
 * Build a CardKit 2.0 card JSON that guides the user through OAuth authorization.
 *
 * Usage:
 *   ```ts
 *   const card = buildOAuthPromptCard({ verificationUrl: 'https://open.feishu.cn/...' });
 *   await channel.send(senderId, { card });
 *   ```
 */
export function buildOAuthPromptCard(opts: OAuthPromptCardOptions): object {
  const {
    verificationUrl,
    reason = '需要授权才能以你的身份操作飞书文档和其他资源。',
    buttonText = '打开授权链接',
    expiresInMinutes,
  } = opts;

  const noteText = [
    '授权完成后，请返回原对话重新发送消息，即可继续。',
    ...(expiresInMinutes ? [`链接将在 ${expiresInMinutes} 分钟后失效。`] : []),
  ].join(' ');

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: false,
      update_multi: false,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '🔐 需要飞书授权',
      },
      template: 'blue',
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag: 'markdown',
          content: reason,
        },
        {
          tag: 'action',
          layout: 'bisected',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: buttonText,
              },
              type: 'primary',
              behaviors: [
                {
                  type: 'open_url',
                  default_url: verificationUrl,
                },
              ],
            },
          ],
        },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: noteText,
            },
          ],
        },
      ],
    },
  };
}
