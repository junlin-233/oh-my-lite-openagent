# Oh My Lite OpenAgent

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个轻量、可全局安装的 OpenCode 编排层。

本项目是独立的 OpenCode 插件，不隶属于 OpenCode 官方，也不代表 OpenCode 官方背书或维护。

它会为 OpenCode 增加默认主控 agent、两个规划模式、受边界约束的 subagent、兼容模型接口的插件工具，以及一个安装后可在任意项目目录生效的全局安装器。

它刻意比 Oh My OpenAgent 更轻。不引入庞大运行时，不绑定特定模型，不创建隐藏自治控制平面。它只是一个容易检查、容易安装、容易卸载的 bounded OpenCode 插件。

## 功能概览

- `command-lead`：默认执行编排 agent。
- `plan-builder`：可见规划模式，用于需求澄清和计划骨架。
- `deep-plan-builder`：可见深度规划模式，并强制进入计划审查。
- `task-lead`、`explore`、`librarian`、`plan-review`、`result-review`：隐藏的受限 subagent。
- 每个角色都参照 OpenCode 的任务追踪风格维护自己的本地 todo 列表，但 todo 不替代 artifact 或 canonical state。
- `result-review` 是用户可选择调用的可选审查，只审查 Command Lead 的执行摘要/最终整合结果，不审查 Task Lead 子任务返回。
- 有委派权的角色派遣任务时使用显式模板：`TASK`、`EXPECTED OUTCOME`、`ROLE`、`SCOPE`、`UPSTREAM EVIDENCE`、`REQUIRED TOOLS`、`MUST DO`、`MUST NOT DO`、`CONTEXT`、`DELIVERABLE FORMAT`、`FAILURE RETURN`。
- 兼容 provider 的插件工具：`bounded_lite_route`、`bounded_lite_plan_dag`、`bounded_lite_background`、`bounded_lite_runtime_profile`、`bounded_lite_model_config`。
- OpenCode 原生 `build` 和 `plan` 模式会被隐藏并禁用。
- 全局安装器会保留你已有的 model、provider、API key、插件和自定义 agent。

## 快速开始

### 安装

```bash
git clone https://github.com/junlin-233/oh-my-lite-openagent.git
cd oh-my-lite-openagent
npm install
npm run install:opencode
```

### 启动 OpenCode

```bash
oc
```

安装后插件是全局生效的。你可以在任意项目目录运行 `oc`。

### 验证

```bash
oc debug config
oc debug agent command-lead
```

`command-lead` 应该显示为 `native: false`，并包含以下工具：

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

## AI 安装

将此提示复制并粘贴到你的 LLM 智能体（Claude Code、AmpCode、Cursor 等）中：

```text
为 OpenCode 安装并配置 Oh My Lite OpenAgent：
https://raw.githubusercontent.com/junlin-233/oh-my-lite-openagent/main/AI-INSTALL.md

严格按照 AI 安装指南执行。
```

AI 安装说明放在 [`AI-INSTALL.md`](./AI-INSTALL.md)。

## 工作方式

安装器只复制 OpenCode 运行所需文件：

```text
.opencode/agents
.opencode/plugins
.opencode/lib
```

然后将仓库里的 `opencode.json` 合并到 OpenCode 全局配置中。

默认配置目录：

```text
Linux/macOS: ~/.config/opencode
Windows:     %APPDATA%\opencode
```

指定目标目录：

```bash
npm run install:opencode -- --config-dir /path/to/opencode-config
```

只演练不写入：

```bash
node scripts/install.mjs --dry-run
```

## 角色模型配置

在 OpenCode TUI 里运行：

```text
/Character-model
```

这个命令会列出每个角色当前使用的模型，以及 OpenCode 配置中可用的 provider 模型。然后告诉 `command-lead` 你想怎么分配，例如：

```text
command-lead、plan-builder 和 plan-review 使用 openai/gpt-5.4。explore 和 librarian 使用 openai/gpt-5.4-mini。
```

命令会把 `agent.<role>.model` 写入 OpenCode 配置，同时保留无关的 provider、model、插件和自定义 agent 设置。

## Agent 列表

| Agent | 可见 | 模式 | 用途 |
| --- | --- | --- | --- |
| `command-lead` | 是 | `primary` | 默认执行编排 |
| `plan-builder` | 是 | `all` | 规划和计划骨架收敛 |
| `deep-plan-builder` | 是 | `all` | 带强制计划审查的深度规划 |
| `task-lead` | 否 | `subagent` | 单个受限委派任务 |
| `explore` | 否 | `subagent` | 本地只读探索 |
| `librarian` | 否 | `subagent` | 外部文档和开源参考检索 |
| `plan-review` | 否 | `subagent` | 计划产物审查 |
| `result-review` | 否 | `subagent` | 可选审查 Command Lead 执行结果 |
| `build` | 否 | `subagent` | 被禁用的 OpenCode 内置模式覆盖 |
| `plan` | 否 | `subagent` | 被禁用的 OpenCode 内置模式覆盖 |

## 常用命令

```bash
npm test
npm run typecheck
npm run build
npm run install:opencode
```

## 卸载

安装器修改全局配置前会写入备份：

```text
opencode.json.bak
```

Linux/macOS 恢复方式：

```bash
cp ~/.config/opencode/opencode.json.bak ~/.config/opencode/opencode.json
```

Windows PowerShell 恢复方式：

```powershell
Copy-Item "$env:APPDATA\opencode\opencode.json.bak" "$env:APPDATA\opencode\opencode.json" -Force
```

移除本地开发产物：

```bash
rm -rf node_modules dist
```

Windows PowerShell：

```powershell
Remove-Item -Recurse -Force node_modules, dist
```

## 故障排查

### `Invalid tools[n].name`

请使用当前插件版本。工具名不能包含点号。合法工具名是：

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

### OpenCode 仍然进入普通 Build/Plan

运行：

```bash
npm run install:opencode
oc debug config
```

确认：

```text
default_agent: command-lead
build.mode: subagent
plan.mode: subagent
```

### 插件只在当前仓库生效

你可能只用了项目本地配置，没有做全局安装。运行：

```bash
npm run install:opencode
```

## 当前状态

- Linux：已验证。
- Windows：按 `%APPDATA%\opencode` 设计支持，但本仓库尚未实机验证。
- 本环境测试的 OpenCode 版本：`1.4.6`。

## 设计规则

- 保持系统有边界。
- 不增加第四个可见模式。
- 不把隐藏 subagent 变成自治控制平面。
- 每个角色的 todo 列表只作为本角色工作记忆，不替代 canonical state 或 artifact 记录。
- Result Review 保持可选，并限定为审查 Command Lead 拥有的执行摘要。
- 派遣任务必须显式、有边界；不要使用隐藏 initiator marker，也不要要求 whole-repo 无边界搜索。
- 插件工具名必须兼容 provider：`^[a-zA-Z0-9_-]+$`。
- 安装时保留用户的 provider、model 和 API 配置。
