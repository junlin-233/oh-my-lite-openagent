# Oh My Lite OpenAgent

[English](./README.md) | [简体中文](./README.zh-CN.md)

A small, installable OpenCode orchestration layer.

This project is an independent OpenCode plugin and is not affiliated with, endorsed by, or maintained by the OpenCode team.

It gives OpenCode a default command lead, two planning modes, bounded subagents, safe plugin tools, and a global installer that works from any project directory after setup.

This is intentionally lighter than Oh My OpenAgent. No giant runtime, no model lock-in, no hidden autonomous control plane. Just a bounded OpenCode plugin that is easy to inspect, install, and remove.

## What You Get

- `command-lead`: the default execution orchestrator.
- `plan-builder`: visible planning mode for requirements and plan skeletons.
- `deep-plan-builder`: visible deep planning mode with mandatory plan review.
- `task-lead`, `explore`, `librarian`, `plan-review`, `result-review`: hidden bounded subagents.
- Task Lead profiles (`quick`, `code`, `research`, `writing`, `visual`, `deep`, `risk-high`) map plan attributes to dispatch metadata and model recommendations without adding extra agents.
- Each role maintains its own local todo list for multi-step work, following OpenCode-style task tracking without replacing artifacts or canonical state.
- `result-review` is optional and user-selectable. It reviews Command Lead execution summaries/final integrated results, not Task Lead child task returns.
- Delegating roles use an explicit assignment template: `TASK`, `EXPECTED OUTCOME`, `ROLE`, `SCOPE`, `UPSTREAM EVIDENCE`, `REQUIRED TOOLS`, `MUST DO`, `MUST NOT DO`, `CONTEXT`, `DELIVERABLE FORMAT`, and `FAILURE RETURN`.
- Durable plan artifacts are written under `.liteagent/plans/` with an append-only `.liteagent/plan-index.jsonl`.
- Provider-safe plugin tools: `bounded_lite_route`, `bounded_lite_plan_dag`, `bounded_lite_plan_readiness`, `bounded_lite_plan_artifact`, `bounded_lite_background`, `bounded_lite_runtime_profile`, `bounded_lite_model_config`.
- OpenCode native `build` and `plan` modes hidden behind disabled overrides.
- A global installer that preserves your existing model, provider, API key, plugins, and custom agents.

## Quick Start

### Install

From npm (after the package is published):

```bash
npm install -g oh-my-lite-openagent
oh-my-lite-openagent
```

Or run without a global install:

```bash
npx oh-my-lite-openagent
```

From source:

```bash
git clone https://github.com/junlin-233/oh-my-lite-openagent.git
cd oh-my-lite-openagent
npm install
npm run install:opencode
```

### Start OpenCode

```bash
opencode
```

After installation, the plugin is global. You can run `opencode` from any project directory.

### Verify

```bash
opencode debug config
opencode debug agent command-lead
```

`command-lead` should be `native: false` and should include:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

## AI Install

If you already have OpenCode, copy and paste this prompt into it:

```text
Install and configure Oh My Lite OpenAgent for OpenCode:
https://raw.githubusercontent.com/junlin-233/oh-my-lite-openagent/main/AI-INSTALL.md

Follow the AI installation guide exactly.
```

The AI agent will:
1. Clone the repo and run `npm install` + `npm run install:opencode`
2. Ask which AI providers you have access to
3. Call `bounded_lite_model_config({ action: "import" })`, then `action: "auto"` to generate role and Task Lead profile recommendations from all discovered providers
4. Verify the installation worked

AI installation instructions live in [`AI-INSTALL.md`](./AI-INSTALL.md).

## How It Works

The installer copies only the runtime files OpenCode needs:

```text
.opencode/agents
.opencode/plugins
.opencode/lib
```

Then it merges `opencode.json` into the OpenCode global config.

Default config locations:

```text
Linux/macOS: ~/.config/opencode
Windows:     %APPDATA%\opencode
```

Override the target directory:

```bash
npm run install:opencode -- --config-dir /path/to/opencode-config
```

Dry run:

```bash
oh-my-lite-openagent --dry-run
# or, from a source checkout:
node scripts/install.mjs --dry-run
```

Interactive model setup:

```bash
oh-my-lite-openagent --interactive
```

## npm Package Publishing

The package exposes the installer as two CLI names: `oh-my-lite-openagent` and `omlo-install`.

Before publishing:

```bash
npm install
npm test
npm run typecheck
npm run pack:dry-run
```

Publish dry run:

```bash
npm run publish:dry-run
```

Publish to npm when ready:

```bash
npm publish
```

If npm asks for a one-time password, enter the 6-digit code from the authenticator app attached to your npm account, or pass it directly:

```bash
npm publish --otp 123456
```

If you prefer not to enter OTP interactively, create a granular npm access token with publish permission and bypass/automation support, then publish with that token:

```bash
npm config set //registry.npmjs.org/:_authToken=YOUR_NPM_TOKEN
npm publish
npm config delete //registry.npmjs.org/:_authToken
```

`prepublishOnly` runs the test suite, typecheck, and package dry run automatically before a real publish.

## Role and Task Lead Profile Model Configuration

Each role needs a model that fits its capability. Run this inside the OpenCode TUI:

```text
/agent-models
```

The command uses the `bounded_lite_model_config` tool. The default workflow is import first, preview role and Task Lead profile recommendations, ask for user changes, then apply.

### import — Load all discovered provider models

```
bounded_lite_model_config({ action: "import" })
```

By default this imports every model provider OpenCode can discover, including subscription providers such as `opencode` and `opencode-go`. The current global `model` is context only; it is not a hard import filter. Codex backend models are excluded unless explicitly allowed.

### auto — Recommend the best imported model for each role and profile

```
bounded_lite_model_config({ action: "auto" })
```

Returns recommended assignments only. It does not write config. The report includes role assignments and `Recommended Task Lead profile assignments JSON`.

| Role              | Needs                  | Best models first                          |
|-------------------|------------------------|--------------------------------------------|
| command-lead      | Strongest reasoning    | strongest imported reasoning model |
| plan-builder      | Strong reasoning       | strongest imported structured planning model |
| deep-plan-builder | Detailed handoff plans | strong imported planning model with mandatory review |
| task-lead         | Mid-tier execution     | capable imported implementation model |
| explore           | Fast & cheap           | fast/cheap imported mini, flash, or highspeed model |
| librarian         | Fast & cheap           | fast/cheap imported mini, flash, or highspeed model |
| plan-review       | Strongest reasoning    | strongest imported review model |
| result-review     | Strongest reasoning    | strongest imported review model |

Task Lead profiles are selected from `plan.subtasks[].attributes`. They do **not** create new agents; they configure dispatch metadata for the single hidden `task-lead` agent. Current profile models are recommendations/fallback metadata unless the runtime supports per-task model override.

| Profile | Matching attributes | Best models first |
| --- | --- | --- |
| `quick` | `quick` | fastest low-cost imported model |
| `code` | `code` | strong bounded implementation model |
| `research` | `research`, `docs` | fast research or documentation lookup model |
| `writing` | `writing` | clear prose/documentation model |
| `visual` | `multimodal`, `visual` | visual-capable or strong UI reasoning model |
| `deep` | `deep`, `large-context` | stronger long-context reasoning model |
| `risk-high` | `risk-high`, `security`, `migration` | strong critical-reasoning model |

### list — Show current role/profile assignments and available models

```
bounded_lite_model_config({ action: "list" })
```

### apply — Manually assign models to roles and profiles

```
bounded_lite_model_config({ action: "apply", assignments: { "command-lead": "openai/gpt-5.4", "explore": "openai/gpt-5.4-mini" } })
```

The `assignments` object maps role names to `provider/model` strings. The `taskLeadProfileAssignments` object maps profile names to `provider/model` strings. Only known roles/profiles are updated. Unknown entries are skipped. Models outside the imported pool are rejected by default.

The same command can preview and apply Task Lead profile models without adding new agents. Profiles are selected from `plan.subtasks[].attributes` and currently act as dispatch metadata unless the runtime supports per-task model override:

```
bounded_lite_model_config({ action: "apply", taskLeadProfileAssignments: { "code": "opencode/claude-sonnet-4-6", "quick": "opencode-go/minimax-m2.7-highspeed" } })
```

Built-in profiles include `quick`, `code`, `research`, `writing`, `visual`, `deep`, and `risk-high`.

You may apply both groups together:

```
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

**Typical workflow**: Run `action=import`, then `action=auto`, ask the user whether they want changes, then use `action=apply`.

## Agent Map

| Agent | Visible | Mode | Purpose |
| --- | --- | --- | --- |
| `command-lead` | yes | `primary` | Default execution orchestrator |
| `plan-builder` | yes | `all` | Planning and skeleton convergence |
| `deep-plan-builder` | yes | `all` | Deep planning with mandatory plan review |
| `task-lead` | no | `subagent` | One bounded delegated task |
| `explore` | no | `subagent` | Local read-only exploration |
| `librarian` | no | `subagent` | External docs and OSS lookup |
| `plan-review` | no | `subagent` | Plan artifact review |
| `result-review` | no | `subagent` | Optional review of Command Lead execution results |
| `build` | no | `subagent` | Disabled OpenCode built-in override |
| `plan` | no | `subagent` | Disabled OpenCode built-in override |

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run install:opencode
```

## Uninstall

The installer writes a backup before changing global config:

```text
opencode.json.bak
```

Restore it on Linux/macOS:

```bash
cp ~/.config/opencode/opencode.json.bak ~/.config/opencode/opencode.json
```

Restore it on Windows PowerShell:

```powershell
Copy-Item "$env:APPDATA\opencode\opencode.json.bak" "$env:APPDATA\opencode\opencode.json" -Force
```

To remove local development artifacts:

```bash
rm -rf node_modules dist
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules, dist
```

## Troubleshooting

### `Invalid tools[n].name`

Use the current plugin version. Tool names must not contain dots. Valid names are:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

### OpenCode still starts in normal Build/Plan

Run:

```bash
npm run install:opencode
opencode debug config
```

Confirm:

```text
default_agent: command-lead
build.mode: subagent
plan.mode: subagent
```

### Plugin only works in this repository

You are probably using the project-local config only. Run the global installer:

```bash
npm run install:opencode
```

## Status

- Linux: verified.
- Windows: designed for `%APPDATA%\opencode`, not yet verified in this repository.
- OpenCode tested version in this environment: `1.4.6`.

## Design Rules

- Keep the system bounded.
- Do not add a fourth visible mode.
- Do not turn hidden subagents into autonomous control planes.
- Keep each role's todo list local to that role; todos do not replace canonical state or artifact records.
- Keep Result Review optional and scoped to Command Lead-owned execution summaries.
- Keep delegated assignments explicit and bounded; do not use hidden initiator markers or whole-repo unbounded search instructions.
- Keep plugin tool names provider-safe: `^[a-zA-Z0-9_-]+$`.
- Preserve user provider/model/API configuration during install.
