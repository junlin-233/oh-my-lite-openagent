# Oh My Lite OpenAgent

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个轻量、可全局安装的 OpenCode 编排层。

受够了复杂的agent框架？来试试oh my lite吧！它足够轻量的同时也保证了多agent的效率，不必再担心太多复杂功能需要学习，你甚至只需要用主agent就可以体验全部功能！感谢oh my openagent的启发，事实上我们也确实借鉴了不少，但是我们足够轻量，足够简洁，这就够了！


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


## AI 安装

不必再看下面又臭又长的文档了，将此提示复制并粘贴到你的 LLM 智能体（Claude Code、AmpCode、Cursor 等）中快速上手！

```text
为 OpenCode 安装并配置 Oh My Lite OpenAgent：
https://raw.githubusercontent.com/junlin-233/oh-my-lite-openagent/main/AI-INSTALL.md

严格按照 AI 安装指南执行。
```

AI 安装说明放在 [`AI-INSTALL.md`](./AI-INSTALL.md)。

## 手动安装（不推荐）

### 安装

通过 npm 安装（发布到 npm 后）：

```bash
npm install -g oh-my-lite-openagent
oh-my-lite-openagent
```

注意：npm registry 上下载到的版本可能落后于仓库 `main` 分支的最新改动。如果需要文档中描述的最新行为，请从源码安装，或先用 `npm view oh-my-lite-openagent version` 确认已发布版本。

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
bounded_lite_plan_artifact
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```



## 工作方式

安装器只复制 OpenCode 运行所需文件：

```text
.opencode/plugins
.opencode/lib
agents/*.md
oh-my-lite-openagent.json
```

然后只将 `scripts/managed-config.mjs` 中的插件/命令启动片段合并到 OpenCode 全局配置中。角色定义会生成到 OpenCode 原生 markdown agent 文件 `<configDir>/agents/*.md`；角色模型和推理强度配置写入 `<configDir>/oh-my-lite-openagent.json`。安装器会从 `opencode.json` 中移除旧的托管角色定义，避免全局配置和 markdown agent 文件出现两份托管角色；用户自定义 agent 会保留。包内不再携带根目录 `opencode.json`；provider、API key、无关插件和自定义 agent 都属于用户自己的 OpenCode 配置。如果目标配置目录里只有 `opencode.jsonc`，安装器会读写 `opencode.jsonc`，不会额外创建 `opencode.json`；如果 `opencode.json` 和 `opencode.jsonc` 同时存在，则以 `opencode.json` 作为活动合并目标。

安装器只会为已经存在的目标文件写 `.bak` 备份，例如已有的 `opencode.json`/`opencode.jsonc` 或已有的 `<configDir>/agents/*.md`；首次创建的新文件不会额外生成空备份。

托管的命令行权限对 8 个真实角色默认较宽松：bash 默认 `allow`，只有危险或敏感命令会 `ask`，例如破坏性文件操作、系统提权/权限命令、会修改 git 历史或远端的命令、npm 发布/移除/改版本、真实写入 OpenCode 全局配置的安装器命令，以及下载后直接执行的管道/eval 形式。该 bash 策略写在全局 `permission.bash`；如果用户已有自己的 `permission` 但缺少 `bash`，安装器会补齐托管的 bash 策略，同时保留用户已有的其他 permission 配置。如果用户已经显式配置了 `permission.bash`，安装器会保留用户配置。被禁用覆盖的 OpenCode 内置 `build` 和 `plan` 仍保持全拒绝。

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

命令会把角色模型写入 `<configDir>/oh-my-lite-openagent.json`，并重新生成 `<configDir>/agents/*.md`，让 OpenCode 从 markdown agent frontmatter 读取对应模型。它不再把 `agent.<role>.model` 写入 `opencode.json`。默认会拒绝导入池外的模型，避免 AI 编造 provider/model。

也可以配置推理强度。Oh My Lite 接受 `minimal`、`low`、`medium`、`high`、`xhigh`、`extra-high`、`max`、`maximum` 等常见值和别名。非法值会回退到角色/profile 默认值；模型厂商不支持的值会降级到安全支持值，或省略该字段让 provider 使用默认行为。

```text
bounded_lite_model_config({
  action: "apply",
  assignments: { "command-lead": "openai/gpt-5.4" },
  reasoningEffortAssignments: { "command-lead": "max" }
})
```

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
  },
  taskLeadProfileReasoningEffortAssignments: {
    "code": "medium",
    "deep": "xhigh",
    "risk-high": "max"
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
opencode.jsonc.bak
oh-my-lite-openagent.json.bak
agents/<role>.md.bak
```

恢复时应恢复安装器输出中显示的活动配置文件。如果安装器使用 `opencode.json`，恢复 `opencode.json`；如果使用 `opencode.jsonc`，恢复 `opencode.jsonc`。

Linux/macOS 恢复方式：

```bash
cp ~/.config/opencode/opencode.json.bak ~/.config/opencode/opencode.json
# 如果你的活动配置是 JSONC：
cp ~/.config/opencode/opencode.jsonc.bak ~/.config/opencode/opencode.jsonc
# 如果还要恢复角色/profile 模型配置：
cp ~/.config/opencode/oh-my-lite-openagent.json.bak ~/.config/opencode/oh-my-lite-openagent.json
```

Windows PowerShell 恢复方式：

```powershell
Copy-Item "$env:APPDATA\opencode\opencode.json.bak" "$env:APPDATA\opencode\opencode.json" -Force
# 如果你的活动配置是 JSONC：
Copy-Item "$env:APPDATA\opencode\opencode.jsonc.bak" "$env:APPDATA\opencode\opencode.jsonc" -Force
# 如果还要恢复角色/profile 模型配置：
Copy-Item "$env:APPDATA\opencode\oh-my-lite-openagent.json.bak" "$env:APPDATA\opencode\oh-my-lite-openagent.json" -Force
```

角色 markdown agent 的备份位于生成文件旁边，形如 `agents/<role>.md.bak`；只恢复你明确想回滚的角色。

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
bounded_lite_plan_artifact
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
