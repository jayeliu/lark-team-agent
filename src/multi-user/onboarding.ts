import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserRecord } from './user-registry';

/**
 * Onboarding welcome message sent to a user on first registration.
 *
 * Content is loaded from `onboarding.md` in the profile config dir if it
 * exists, so operators can customise it without touching code.
 * Falls back to the built-in default below.
 */
export function buildWelcomeMessage(user: UserRecord, onboardingMdPath?: string): string {
  if (onboardingMdPath && existsSync(onboardingMdPath)) {
    const tpl = readFileSync(onboardingMdPath, 'utf8');
    return interpolate(tpl, user);
  }
  return interpolate(DEFAULT_ONBOARDING, user);
}

function interpolate(tpl: string, user: UserRecord): string {
  return tpl
    .replace(/\{name\}/g, user.name)
    .replace(/\{workspace\}/g, user.workspace)
    .replace(/\{pinyinDir\}/g, user.pinyinDir);
}

const DEFAULT_ONBOARDING = `👋 你好，**{name}**！我是团队 AI Agent，已为你初始化个人工作空间。

**📁 你的工作目录**
\`{workspace}\`

**🚀 核心能力**
- 代码编写 / 重构 / Debug
- 文件读写与项目管理
- 飞书文档、表格、多维表格操作
- 网络搜索与信息整理
- 数据分析（DataFinder）

**💬 常用指令**
| 指令 | 说明 |
|------|------|
| \`/cd <路径>\` | 切换工作目录 |
| \`/ws save <名称>\` | 保存常用目录 |
| \`/ws list\` | 查看已保存目录 |
| \`/new chat\` | 创建独立私群（适合长任务） |
| \`/new\` | 重置当前会话 |
| \`/status\` | 查看当前状态 |
| \`/stop\` | 中断当前任务 |

**📝 长期记忆**
重要背景信息会自动存入 \`{workspace}/CC-Memory/\`，下次对话时会主动读取。

直接发消息开始吧！
`;
