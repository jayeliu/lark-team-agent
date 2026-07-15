# lark-channel-bridge-team

> This project is a fork of [zhangzara/lark-channel-bridge](https://github.com/zhangzara/lark-channel-bridge), extended under the MIT license. Big thanks to zhangzara for building this excellent bridge and for openly encouraging community forks — this project wouldn't exist without that spirit.

[中文 README](./README.zh.md)

A team-grade bot that bridges Feishu / Lark messenger with local Claude Code CLI. On top of the original bridge, it adds multi-user workspace isolation, first-contact onboarding, and dynamic model switching — designed for teams that want to share a single deployed bot while keeping each member's sessions, working directories, and memory completely separate.

---

## Who this is for

| Scenario | Details |
|----------|---------|
| **Shared team AI Agent** | Product, engineering, and design members all talk to the same Feishu bot, each with fully isolated sessions and working directories |
| **Server-side deployment** | Deploy once on a cloud server; team members need no local setup |
| **Multiple projects** | Each user has a personal workspace and can freely switch between projects with `/cd` and `/ws` |
| **Solo developers** | Multi-user mode is opt-in; when disabled, behaviour is identical to the original bridge |

---

## Core problems solved

The original bridge is a personal tool for a single developer. When shared across a team:

1. **Session cross-contamination** — everyone shares one session and interferes with each other
2. **Working directory conflicts** — `/cd` changes the directory for everyone simultaneously
3. **No user attribution** — logs and memory files are intermixed with no way to trace who did what
4. **No onboarding** — new members have no idea what the bot can do or how to use it

This fork solves all four with a **multi-user architecture**: the first time a user DMs the bot, their workspace is automatically initialized; all subsequent operations stay inside their own space.

---

## Feature overview

### New features

#### Multi-user workspace isolation

- **Auto-init on first contact**: when a user DMs the bot for the first time, the bridge reads their Feishu display name, converts it to a pinyin directory name, and creates a personal workspace under `workspaceRoot`
- **Directory layout**: each user workspace contains `projects/` and `CC-Memory/`
- **Pre-seeded config files**: `CLAUDE.md` (workspace conventions) and `user.md` (user identity) are written on initialization
- **Stable session scope**: p2p scope is keyed by `senderId` instead of `chatId`, surviving app reinstalls and device switches
- **Concurrency-safe**: concurrent first messages from the same user share a single registration promise; registration failures send a visible error and halt further processing

Enable in your profile config:

```json
{
  "multiUser": {
    "enabled": true,
    "workspaceRoot": "/workspace"
  }
}
```

#### First-contact onboarding

- After workspace initialization, the bot sends a welcome message introducing its capabilities and available commands
- Supports an external `onboarding.md` file for custom content, with `{name}`, `{workspace}`, and `{pinyinDir}` placeholders
- Built-in default content covers: capability overview, command reference table, and CC-Memory usage guide

#### Dynamic model switching (`/model`)

| Command | Effect |
|---------|--------|
| `/model` | Show the current model |
| `/model list` | Query available models from the API, grouped by family, with the current model marked |
| `/model <name>` | Switch to the named model; takes effect on the next message |
| `/model reset` | Restore the default model (controlled by `ANTHROPIC_MODEL` env var) |

- Model setting is persisted to `config.json` and survives restarts
- In-memory state is updated immediately — no bridge restart needed
- `/model list` calls `/v1/models` and supports the official Anthropic API and compatible proxies

#### Reusable model-query module (`src/anthropic/models`)

A standalone module for any project that needs to enumerate models:

- `fetchModels(opts?)` — queries `/v1/models`, never throws, returns a typed result union
- `groupModels(models)` — groups by family (Claude / GPT / DeepSeek / Qwen / GLM / Kimi / MiniMax / Embeddings / Other)
- `formatFetchModelsError(error)` — human-readable error messages
- Built-in 10 s timeout with proper AbortController cleanup; full error codes: `missing-api-key` / `timeout` / `network-error` / `http-error` / `parse-error`

---

### Original features (fully preserved)

#### Message forwarding

- Send a DM directly, or `@bot` in a group, to forward tasks to local Claude Code or Codex CLI
- **Streaming card**: text replies and tool calls update in real time on a single Lark card
- **COT process messages**: optionally send a progress message with agent step text and tool summaries, then deliver the final answer separately
- **Session continuity**: each chat, topic, or document comment thread keeps its own session
- **Queuing and batching**: messages sent in quick succession are handled together; messages during a run queue for the next turn; `/new`, `/cd`, `/ws use`, and `/stop` interrupt the current run

#### Working directory management

| Command | Effect |
|---------|--------|
| `/cd <path>` | Switch working directory and reset the current session |
| `/ws list` | List named workspaces |
| `/ws save <name>` | Save the current directory under a name |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |

#### Session management

| Command | Effect |
|---------|--------|
| `/new` / `/reset` | Clear the current session |
| `/new chat [name]` | Create a Feishu group chat bound to a new session, inheriting the current working directory |
| `/resume` | Browse and restore compatible history sessions |
| `/stop` | Stop the current run |
| `/timeout [N\|off\|default]` | Set or clear the session idle watchdog |

#### Status and configuration

| Command | Effect |
|---------|--------|
| `/status` | Show profile, agent, cwd, session, lark-cli identity, and run state |
| `/config` | Adjust reply mode, tool-call display, COT mode, access lists, and lark-cli identity |
| `/model` | Show / switch model (new, see above) |
| `/help` | Help card |

#### Access control

Private by default — only the bot creator can use it. Manage access with:

| Command | Effect |
|---------|--------|
| `/invite user @name` | Allow a user to DM the bot |
| `/invite admin @name` | Add an admin |
| `/invite group` | Allow the current group |
| `/invite all group` | Allow every group the bot is in |
| `/remove user/admin/group …` | Remove access |

#### System maintenance

| Command | Effect |
|---------|--------|
| `/ps` | List local bridge processes |
| `/exit <id\|#>` | Stop a bridge process |
| `/reconnect` | Force a WebSocket reconnect |
| `/doctor [description]` | Run low-sensitivity diagnostics |

#### Media and files

- Send images or files directly to the bot; the bridge downloads them locally before passing them to the agent
- CloudDoc comment mentions are handled per document thread

#### Multiple profiles / agents

- Each profile has its own app credentials, sessions, workspaces, lark-cli directory, and logs
- Run Claude and Codex as separate bots using separate profiles

---

## Quick deployment (server)

### Prerequisites

- Node.js >= 20.12.0
- Claude Code installed and logged in: `claude` — see https://docs.anthropic.com/en/docs/claude-code/quickstart
- A Feishu / Lark PersonalAgent app (the first-run wizard can create one)

### Install

```bash
git clone https://github.com/your-org/lark-channel-bridge-team.git
cd lark-channel-bridge-team
pnpm install
pnpm build
```

### First run

```bash
node dist/bin.js run
```

### Enable multi-user mode

Edit `~/.lark-channel/config.json` and add to the active profile:

```json
{
  "multiUser": {
    "enabled": true,
    "workspaceRoot": "/workspace"
  }
}
```

Ensure the root directory exists and is writable by the bridge process:

```bash
mkdir -p /workspace
```

Restart the bridge. The next user to DM the bot will be automatically onboarded.

### Custom onboarding content

Place an `onboarding.md` file in the bridge config directory. Supported placeholders:

```
{name}        User's Feishu display name
{workspace}   Absolute path to the user's workspace
{pinyinDir}   Workspace directory name (pinyin of the user's name)
```

---

## Data directories

| Path | Content |
|------|---------|
| `~/.lark-channel/config.json` | Root config (profiles + active profile) |
| `~/.lark-channel/profiles/<profile>/sessions.json` | Session state |
| `~/.lark-channel/profiles/<profile>/workspaces.json` | Workspace bindings |
| `~/.lark-channel/profiles/<profile>/users.json` | Multi-user registry (multi-user mode) |
| `~/.lark-channel/profiles/<profile>/lark-cli/` | Profile-local lark-cli directory |
| `~/.lark-channel/profiles/<profile>/logs/` | Structured run logs |
| `/workspace/<pinyinDir>/` | User personal workspace (multi-user mode) |
| `/workspace/<pinyinDir>/CLAUDE.md` | Workspace conventions |
| `/workspace/<pinyinDir>/user.md` | User identity info |
| `/workspace/<pinyinDir>/CC-Memory/` | User long-term memory directory |
| `/workspace/<pinyinDir>/projects/` | User project directory |

---

## Permission modes

| Bridge access | Claude permission mode |
|---------------|----------------------|
| `full` | `bypassPermissions` |
| `workspace` | `acceptEdits` |
| `read-only` | `plan` |

---

## Acknowledgements

This project is built on top of [zhangzara/lark-channel-bridge](https://github.com/zhangzara/lark-channel-bridge) under the MIT license. Thank you zhangzara for creating such a solid foundation for bridging Feishu with local AI agents, and for welcoming community forks.

---

## License

[MIT](./LICENSE)
