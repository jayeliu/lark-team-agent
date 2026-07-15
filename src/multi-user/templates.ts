export interface UserTemplateVars {
  name: string;
  openId: string;
  pinyinDir: string;
  registeredAt: string;
  workspaceRoot: string;
}

export function renderClaudeMd(vars: UserTemplateVars): string {
  return `# ${vars.name} 的工作空间

## 用户信息
- 飞书姓名：${vars.name}
- 工作目录：${vars.workspaceRoot}/${vars.pinyinDir}/

## 长期记忆
将可复用的背景信息存入 \`CC-Memory/\` 目录，按主题命名（如 \`project-xxx.md\`）。
每次对话开始时，如果用户提到某个项目，先检查 \`CC-Memory/\` 下是否有对应文件。

归档格式：
\`\`\`
## YYYY-MM-DD
### 操作摘要
...
### 关键信息
- ...
\`\`\`

## 工作目录规范
- 默认目录：\`${vars.workspaceRoot}/${vars.pinyinDir}/\`
- 使用 \`/cd <路径>\` 切换到具体项目目录
- 使用 \`/ws save <名称>\` 保存常用目录
- 使用 \`/new chat\` 创建独立私群（适合长时间任务）
`;
}

export function renderUserMd(vars: UserTemplateVars): string {
  return `# 用户档案

- **姓名**：${vars.name}
- **飞书 OpenID**：${vars.openId}
- **工作目录**：${vars.workspaceRoot}/${vars.pinyinDir}/
- **初始化时间**：${vars.registeredAt}
`;
}
