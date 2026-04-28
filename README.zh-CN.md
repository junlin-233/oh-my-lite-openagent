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
- Task Lead profiles（`quick`、`code`、`research`、`writing`、`visual`、`deep`、`risk-high`）会把计划属性映射为派发元数据和模型推荐，但不会新增真实 agent。
- 每个角色都参照 OpenCode 的任务追踪风格维护自己的本地 todo 列表，但 todo 不替代 artifact 或 canonical state。
- `result-review` 是用户可选择调用的可选审查，只审查 Command Lead 的执行摘要/最终整合结果，不审查 Task Lead 子任务返回。
- 有委派权的角色派遣任务时使用显式模板：`TASK`、`EXPECTED OUTCOME`、`ROLE`、`SCOPE`、`UPSTREAM EVIDENCE`、`REQUIRED TOOLS`、`MUST DO`、`MUST NOT DO`、`CONTEXT`、`DELIVERABLE FORMAT`、`FAILURE RETURN`。
- 持久化计划 artifact 会写入 `.liteagent/plans/`，并追加索引 `.liteagent/plan-index.jsonl`。
- 兼容 provider 的插件工具：`bounded_lite_route`、`bounded_lite_plan_dag`、`bounded_lite_plan_readiness`、`bounded_lite_plan_artifact`、`bounded_lite_background`、`bounded_lite_runtime_profile`、`bounded_lite_model_config`。
- OpenCode 原生 `build` 和 `plan` 模式会被隐藏并禁用。
- 全局安装器会保留你已有的 model、provider、API key、插件和自定义 agent。

## 快速开始

### 安装

通过 npm 安装（发布到 npm 后）：

```bash
npm install -g oh-my-lite-openagent
oh-my-lite-openagent
```

不全局安装，直接运行：

```bash
npx oh-my-lite-openagent
```

从源码安装：

```bash
git clone https://github.com/junlin-233/oh-my-lite-openagent.git
cd oh-my-lite-openagent
npm install
npm run install:opencode
```

### 启动 OpenCode

```bash
opencode
```

安装后插件是全局生效的。你可以在任意项目目录运行 `opencode`。

### 验证

```bash
opencode debug config
opencode debug agent command-lead
```

`command-lead` 应该显示为 `native: false`，并包含以下工具：

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
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
oh-my-lite-openagent --dry-run
# 或在源码仓库中：
node scripts/install.mjs --dry-run
```

交互式模型配置：

```bash
oh-my-lite-openagent --interactive
```

## npm 包发布流程

包会暴露两个 CLI 名称：`oh-my-lite-openagent` 和 `omlo-install`。

发布前先检查：

```bash
npm install
npm test
npm run typecheck
npm run pack:dry-run
```

发布演练：

```bash
npm run publish:dry-run
```

确认后发布：

```bash
npm publish
```

如果 npm 提示输入一次性验证码（OTP），打开 npm 账号绑定的验证器 App，输入对应的 6 位验证码；也可以直接传入：

```bash
npm publish --otp 123456
```

如果不想交互式输入 OTP，可以在 npm 创建带发布权限且支持 bypass/automation 的 granular access token，然后用 token 发布：

```bash
npm config set //registry.npmjs.org/:_authToken=YOUR_NPM_TOKEN
npm publish
npm config delete //registry.npmjs.org/:_authToken
```

真实发布前 `prepublishOnly` 会自动执行测试、类型检查和打包演练。

## 角色与 Task Lead Profile 模型配置

在 OpenCode TUI 里运行：

```text
/agent-models
```

这个命令会先导入 OpenCode 能发现的全部可用模型池，再让 AI 在这个模型池内按角色能力和 Task Lead profile 能力给出推荐。默认会包含 `openai`、`opencode`、`opencode-go` 等已连接 provider；当前全局 `model` 只作为上下文，不作为硬过滤条件。Codex 后端模型默认排除。

推荐流程：

```text
bounded_lite_model_config({ action: "import" })
bounded_lite_model_config({ action: "auto" })
```

`action: "auto"` 只返回推荐，不会写配置。它会同时返回角色推荐和 `Recommended Task Lead profile assignments JSON`。需要先把推荐结果展示给用户，询问是否修改，然后再执行 `action: "apply"`。

角色推荐：

| Role | 能力需求 | 推荐方向 |
| --- | --- | --- |
| `command-lead` | 最强推理 | 最强的编排/推理模型 |
| `plan-builder` | 强规划 | 擅长结构化计划的强模型 |
| `deep-plan-builder` | 详细交接计划 | 适合低强度执行模型交接的强规划模型 |
| `task-lead` | 受限执行 | 作为默认/兜底执行器的中高档实现模型 |
| `explore` | 快速检索 | 快速、便宜的 mini/flash/highspeed 模型 |
| `librarian` | 快速研究 | 快速、便宜的文档/研究模型 |
| `plan-review` | 关键审查 | 强推理审查模型 |
| `result-review` | 结果核验 | 强推理核验模型 |

Task Lead profiles 由 `plan.subtasks[].attributes` 选择。它们**不会**新增真实 agent，只为单一隐藏 `task-lead` 配置派发元数据。当前 profile 模型作为推荐/兜底元数据使用，除非运行时支持 per-task model override。

| Profile | 匹配 attributes | 推荐方向 |
| --- | --- | --- |
| `quick` | `quick` | 最快、低成本模型 |
| `code` | `code` | 强代码实现模型 |
| `research` | `research`, `docs` | 快速研究/文档检索模型 |
| `writing` | `writing` | 文档和说明文字模型 |
| `visual` | `multimodal`, `visual` | 视觉能力或强 UI 推理模型 |
| `deep` | `deep`, `large-context` | 更强长上下文推理模型 |
| `risk-high` | `risk-high`, `security`, `migration` | 高风险变更用强审慎推理模型 |

手动微调时只能写入导入池里存在的模型，例如：

```text
bounded_lite_model_config({ action: "apply", assignments: { "command-lead": "openai/gpt-5.4", "explore": "openai/gpt-5.4-mini" } })
```

命令会把 `agent.<role>.model` 写入 OpenCode 配置，同时保留无关的 provider、model、插件和自定义 agent 设置。默认会拒绝导入池外的模型，避免 AI 编造 provider/model。

同一个命令也可以预览和写入 Task Lead profile 模型，而不新增真实 agent。profile 由 `plan.subtasks[].attributes` 选择；当前它们作为派发元数据使用，除非运行时支持 per-task model override：

```text
bounded_lite_model_config({ action: "apply", taskLeadProfileAssignments: { "code": "opencode/claude-sonnet-4-6", "quick": "opencode-go/minimax-m2.7-highspeed" } })
```

内置 profile 包括 `quick`、`code`、`research`、`writing`、`visual`、`deep`、`risk-high`。

也可以同时写入角色模型和 profile 模型：

```text
bounded_lite_model_config({
  action: "apply",
  assignments: {
    "command-lead": "openai/gpt-5.4",
    "task-lead": "opencode/kimi-k2.5"
  },
  taskLeadProfileAssignments: {
    "code": "opencode/claude-sonnet-4-6",
    "quick": "opencode-go/minimax-m2.7-highspeed",
    "visual": "google/gemini-3.1-pro"
  }
})
```

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
bounded_lite_plan_readiness
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

### OpenCode 仍然进入普通 Build/Plan

运行：

```bash
npm run install:opencode
opencode debug config
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
