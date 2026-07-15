# lark-channel-bridge-team

> 本项目是 [zhangzara/lark-channel-bridge](https://github.com/zhangzara/lark-channel-bridge) 的二次创作版本，基于原项目 MIT 协议进行功能扩展。感谢 zhangzara 开源这一优质项目，并鼓励社区在此基础上二创——正是这份开放精神让本项目得以诞生。

把飞书 / Lark 消息和本地 Claude Code 打通的团队级 bot。支持多用户独立工作空间、自动初始化引导、模型动态切换等扩展功能，适合将 AI Agent 能力开放给整个产品/研发团队使用。

[English README](./README.md)

---

## 适用场景

| 场景 | 说明 |
|------|------|
| **团队共用 AI Agent** | 产品、研发、设计等多个角色通过同一个飞书 bot 使用 Claude Code，各自的会话、工作目录、记忆完全隔离 |
| **企业/团队部署** | 部署在云服务器，成员无需本地安装任何环境，开箱即用 |
| **多项目并行** | 每个用户拥有独立工作空间，可通过 `/cd`、`/ws` 在不同项目间自由切换 |
| **个人开发者** | 兼容原版单用户模式，不启用多用户时与原版完全一致 |

---

## 解决的核心问题

**原版 lark-channel-bridge 是面向单一开发者的个人工具**，多人共用时存在以下问题：

1. **会话串扰**：所有人共用同一个 session，互相影响
2. **工作目录冲突**：`/cd` 切换对所有人生效，无法各自维护项目路径
3. **无法区分用户**：日志、记忆文件混在一起，无法追溯是谁的操作
4. **无使用引导**：新成员加入后不知道 bot 能做什么、怎么用

本项目通过**多用户架构**解决上述问题：每个飞书用户首次私聊 bot 时自动初始化独立工作空间，后续所有操作均在自己的空间内完成，互不干扰。

---

## 功能全览

### 新增功能

#### 多用户工作空间（Multi-User Workspace）

- **自动初始化**：用户首次私聊 bot 时，自动根据飞书姓名生成拼音目录，在 `workspaceRoot` 下创建专属工作空间
- **目录结构**：每个用户空间包含 `projects/`（项目目录）和 `CC-Memory/`（长期记忆目录）
- **预置配置文件**：自动写入 `CLAUDE.md`（工作空间使用约定）和 `user.md`（用户身份信息）
- **会话隔离**：p2p 私聊的 session scope 改为 `senderId`（不再是 `chatId`），跨设备、跨重装保持稳定
- **并发安全**：同一用户短时间内发多条消息不会触发重复注册，注册失败会给出明确提示

启用方式（在 `config.json` 对应 profile 中）：

```json
{
  "multiUser": {
    "enabled": true,
    "workspaceRoot": "/workspace"
  }
}
```

#### 首次使用引导（Onboarding）

- 用户工作空间初始化完成后，自动发送欢迎消息，介绍 bot 能力和可用指令
- 支持通过外部 `onboarding.md` 文件自定义引导内容，支持 `{name}`、`{workspace}`、`{pinyinDir}` 占位符
- 内置默认引导内容，包含：能力介绍、常用指令说明、CC-Memory 使用方法

#### 模型动态切换（/model）

| 指令 | 效果 |
|------|------|
| `/model` | 查看当前使用的模型 |
| `/model list` | 查询 API 可用模型列表（按系列分组），标注当前模型 |
| `/model <名称>` | 切换到指定模型，立即对下一次对话生效 |
| `/model reset` | 恢复默认模型（由 `ANTHROPIC_MODEL` 环境变量决定） |

- 模型设置持久化写入 `config.json`，重启后仍然生效
- 切换后内存即时同步，无需重启 bridge
- `/model list` 调用 `/v1/models` 接口，支持 Anthropic 官方 API 及兼容代理（如 modelproxy）

#### 可用模型查询模块（anthropic/models）

独立的通用模块，可被其他项目复用：

- `fetchModels(opts?)` — 查询可用模型列表，永不抛出，返回类型化结果
- `groupModels(models)` — 按系列（Claude / GPT / DeepSeek / Qwen / GLM / Kimi / MiniMax 等）分组
- `formatFetchModelsError(error)` — 错误信息格式化（中文）
- 内置 10s 超时、AbortController 清理、完整错误码（`missing-api-key` / `timeout` / `network-error` / `http-error` / `parse-error`）

---

### 原版功能（完整保留）

#### 消息转发

- 在飞书私聊直接发消息，或在群里 `@bot`，把任务转给本机 Claude Code / Codex CLI
- **流式卡片**：文本回复和工具调用实时更新在同一张卡片上
- **COT 过程消息**：可选先发一条过程消息展示 agent 的阶段性进度，再单独发送最终答案
- **会话延续**：每个聊天、话题、文档评论有自己的 session，不会互相串
- **消息排队与合并**：短时间连续发送的消息合并处理；任务运行中的消息排队到下一轮

#### 工作目录管理

| 指令 | 效果 |
|------|------|
| `/cd <path>` | 切换工作目录，重置当前 session |
| `/ws list` | 查看所有已保存的工作目录 |
| `/ws save <name>` | 将当前目录保存为别名 |
| `/ws use <name>` | 切换到已保存的工作目录 |
| `/ws remove <name>` | 删除工作目录别名 |

#### 会话管理

| 指令 | 效果 |
|------|------|
| `/new` / `/reset` | 清除当前 session，开始新对话 |
| `/new chat [名称]` | 新建飞书群并关联 session，自动继承当前工作目录 |
| `/resume` | 查看并恢复历史 session |
| `/stop` | 停止当前正在运行的任务 |
| `/timeout [N\|off\|default]` | 设置或清除当前 session 的空闲超时 |

#### 状态与配置

| 指令 | 效果 |
|------|------|
| `/status` | 查看 profile、agent、工作目录、session、lark-cli 身份、运行状态 |
| `/config` | 调整展示偏好、访问控制、lark-cli 身份策略 |
| `/model` | 查看/切换模型（新增，见上） |
| `/help` | 帮助卡片 |

#### 访问控制

出厂默认只有 bot 创建者可以使用；通过以下指令管理权限：

| 指令 | 效果 |
|------|------|
| `/invite user @某人` | 允许该用户私聊 bot |
| `/invite admin @某人` | 添加为管理员 |
| `/invite group` | 将当前群加入响应名单 |
| `/invite all group` | 一键加入 bot 所在的所有群 |
| `/remove user/admin/group ...` | 移除对应权限 |

#### 系统维护

| 指令 | 效果 |
|------|------|
| `/ps` | 列出本地所有 bridge 进程 |
| `/exit <id\|#>` | 停止某个 bridge 进程 |
| `/reconnect` | 强制 WebSocket 重连 |
| `/doctor [描述]` | 运行诊断（低敏感度） |

#### 多媒体与文件

- 图片和文件直接发给 bot，bridge 下载到本地后交给 agent 处理
- 支持 CloudDoc 评论中 @bot 触发回复

#### 多 Profile / 多 Agent

- 每个 profile 独立维护 app 凭证、sessions、工作目录、lark-cli 目录和日志
- 支持同时运行 Claude + Codex 两个 bot（使用不同 profile）

---

## 快速部署（服务器端）

### 前置条件

- Node.js >= 20.12.0
- Claude Code 已安装并登录：`claude`，详见 https://docs.anthropic.com/en/docs/claude-code/quickstart
- 一个飞书 PersonalAgent 应用（首次启动向导可帮助创建）

### 安装

```bash
git clone https://github.com/your-org/lark-channel-bridge-team.git
cd lark-channel-bridge-team
pnpm install
pnpm build
```

### 首次启动

```bash
node dist/bin.js run
```

### 启用多用户模式

编辑 `~/.lark-channel/config.json`，在对应 profile 中添加：

```json
{
  "multiUser": {
    "enabled": true,
    "workspaceRoot": "/workspace"
  }
}
```

确保 `workspaceRoot` 目录已存在且 bridge 进程有写权限：

```bash
mkdir -p /workspace
```

重启 bridge 后，新用户首次私聊即自动完成工作空间初始化。

### 自定义引导内容

在 bridge 配置目录下创建 `onboarding.md`，支持以下占位符：

```
{name}        用户飞书姓名
{workspace}   用户工作空间绝对路径
{pinyinDir}   工作空间目录名（拼音）
```

---

## 数据目录

| 路径 | 内容 |
|------|------|
| `~/.lark-channel/config.json` | 根配置（profiles + 活跃 profile） |
| `~/.lark-channel/profiles/<profile>/sessions.json` | Session 状态 |
| `~/.lark-channel/profiles/<profile>/workspaces.json` | 工作目录绑定 |
| `~/.lark-channel/profiles/<profile>/users.json` | 多用户注册表（多用户模式） |
| `~/.lark-channel/profiles/<profile>/lark-cli/` | Profile 独立的 lark-cli 目录 |
| `~/.lark-channel/profiles/<profile>/logs/` | 结构化运行日志 |
| `/workspace/<pinyinDir>/` | 用户独立工作空间（多用户模式） |
| `/workspace/<pinyinDir>/CLAUDE.md` | 工作空间使用约定 |
| `/workspace/<pinyinDir>/user.md` | 用户身份信息 |
| `/workspace/<pinyinDir>/CC-Memory/` | 用户长期记忆目录 |
| `/workspace/<pinyinDir>/projects/` | 用户项目目录 |

---

## 权限模式

| Bridge 访问模式 | Claude 权限模式 |
|----------------|----------------|
| `full` | `bypassPermissions` |
| `workspace` | `acceptEdits` |
| `read-only` | `plan` |

---

## 致谢

本项目基于 [zhangzara/lark-channel-bridge](https://github.com/zhangzara/lark-channel-bridge) 开发，遵循 MIT 协议。感谢 zhangzara 构建了如此完善的飞书-Claude Code 桥接基础设施，并以开放的态度鼓励社区在此之上继续创作。

---

## License

[MIT](./LICENSE)
