# Oh My Lite OpenAgent

[English](./README.md) | [简体中文](./README.zh-CN.md)

A lightweight, globally installable OpenCode orchestration layer.

Tired of complicated agent frameworks? Try Oh My Lite! It stays lightweight while still preserving the efficiency of multi-agent workflows. You do not need to worry about learning a pile of complex features; you can even use only the main agent and still experience the full feature set. Thanks to Oh My OpenAgent for the inspiration. We did borrow quite a bit from it, but this project is lightweight enough and simple enough — and that is the point.

## Feature Overview

- `command-lead`: the default execution orchestrator agent.
- `plan-builder`: visible planning mode for requirement clarification and plan skeletons.
- `deep-plan-builder`: visible deep-planning mode with mandatory plan review.
- `task-lead`, `explore`, `librarian`, `plan-review`, `result-review`: hidden bounded subagents.
- Task Lead profiles (`quick`, `code`, `research`, `writing`, `visual`, `deep`, `risk-high`) map plan attributes to dispatch metadata and model recommendations without adding real agents.
- Each role maintains its own local todo list following OpenCode-style task tracking, but todos do not replace artifacts or canonical state.
- `result-review` is optional and user-selectable. It reviews Command Lead execution summaries/final integrated results, not Task Lead child task returns.
- Delegating roles use an explicit assignment template: `TASK`, `EXPECTED OUTCOME`, `ROLE`, `SCOPE`, `UPSTREAM EVIDENCE`, `REQUIRED TOOLS`, `MUST DO`, `MUST NOT DO`, `CONTEXT`, `DELIVERABLE FORMAT`, and `FAILURE RETURN`.
- Durable plan artifacts are written to `.liteagent/plans/`, with an append-only index at `.liteagent/plan-index.jsonl`.
- Provider-compatible plugin tools: `bounded_lite_route`, `bounded_lite_plan_dag`, `bounded_lite_plan_readiness`, `bounded_lite_plan_artifact`, `bounded_lite_background`, `bounded_lite_runtime_profile`, `bounded_lite_model_config`.
- OpenCode's native `build` and `plan` modes are hidden and disabled.
- The global installer preserves your existing model, provider, API key, plugin, and custom agent settings.

## AI Installation

You do not need to read the long manual documentation below. Copy and paste this prompt into your LLM agent, such as Claude Code, AmpCode, Cursor, or similar tools, to get started quickly:

```text
Install and configure Oh My Lite OpenAgent for OpenCode:
https://raw.githubusercontent.com/junlin-233/oh-my-lite-openagent/main/AI-INSTALL.md

Follow the AI installation guide exactly.
```

The AI installation guide lives in [`AI-INSTALL.md`](./AI-INSTALL.md).

## Manual Installation (Not Recommended)

### Install

Install from npm after the package is published:

```bash
npm install -g oh-my-lite-openagent
oh-my-lite-openagent
```

Note: the version downloaded from the npm registry may lag behind the latest changes on the repository `main` branch. If you need the newest behavior described in the documentation, install from source or first check the published version with `npm view oh-my-lite-openagent version`.

Run without a global install:

```bash
npx oh-my-lite-openagent
```

Install from source:

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

`command-lead` should show `native: false` and include these tools:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_plan_artifact
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

## How It Works

The installer only copies the files OpenCode needs at runtime:

```text
.opencode/plugins
.opencode/lib
agents/*.md
oh-my-lite-openagent.json
```

Then it merges only the plugin/command bootstrap fragment from `scripts/managed-config.mjs` into the OpenCode global config. Role definitions are generated as OpenCode markdown agents under `<configDir>/agents/*.md`; role model and reasoning settings live in `<configDir>/oh-my-lite-openagent.json`. The package no longer ships a root `opencode.json`; provider, API key, unrelated plugin, and custom agent settings belong to the user's own OpenCode config. If the target config directory only has `opencode.jsonc`, the installer reads and writes `opencode.jsonc` and does not create an extra `opencode.json`; if both `opencode.json` and `opencode.jsonc` exist, `opencode.json` is treated as the active merge target.

Managed command-line permissions are intentionally permissive for the eight real roles: bash defaults to `allow`, and only dangerous or sensitive commands ask for confirmation. Examples include destructive file operations, system privilege/permission commands, commands that modify git history or remotes, npm publish/remove/version commands, installer commands that actually write OpenCode global config, and pipe/eval forms that execute downloaded content. The disabled OpenCode built-in `build` and `plan` overrides remain fully denied.

Default config directories:

```text
Linux/macOS: ~/.config/opencode
Windows:     %APPDATA%\opencode
```

Specify a target directory:

```bash
npm run install:opencode -- --config-dir /path/to/opencode-config
```

Dry run without writing files:

```bash
oh-my-lite-openagent --dry-run
# Or from a source checkout:
node scripts/install.mjs --dry-run
```

Interactive model configuration:

```bash
oh-my-lite-openagent --interactive
```

## npm Package Publishing

The package exposes two CLI names: `oh-my-lite-openagent` and `omlo-install`.

Before publishing, run:

```bash
npm install
npm test
npm run typecheck
npm run pack:dry-run
```

Publishing dry run:

```bash
npm run publish:dry-run
```

Publish after confirmation:

```bash
npm publish
```

If npm asks for a one-time password (OTP), open the authenticator app connected to your npm account and enter the corresponding 6-digit code. You can also pass it directly:

```bash
npm publish --otp 123456
```

If you do not want to enter OTP interactively, create a granular access token with publish permissions and bypass/automation support, then publish with that token:

```bash
npm config set //registry.npmjs.org/:_authToken=YOUR_NPM_TOKEN
npm publish
npm config delete //registry.npmjs.org/:_authToken
```

Before a real publish, `prepublishOnly` automatically runs tests, typecheck, and package dry run.

## Role and Task Lead Profile Model Configuration

Run this inside the OpenCode TUI:

```text
/agent-models
```

This command first imports all model pools OpenCode can discover, then asks AI to recommend models from that pool based on role capabilities and Task Lead profile capabilities. By default, it includes connected providers such as `openai`, `opencode`, and `opencode-go`; the current global `model` is context only and is not used as a hard filter. Codex backend models are excluded by default.

Recommended workflow:

```text
bounded_lite_model_config({ action: "import" })
bounded_lite_model_config({ action: "auto" })
```

`action: "auto"` only returns recommendations and does not write config. It returns both role recommendations and `Recommended Task Lead profile assignments JSON`. Show the recommendations to the user first, ask whether they want changes, and only then run `action: "apply"`.

Role recommendations:

| Role | Capability Need | Recommendation Direction |
| --- | --- | --- |
| `command-lead` | Strongest reasoning | Strongest orchestration/reasoning model |
| `plan-builder` | Strong planning | Strong model good at structured planning |
| `deep-plan-builder` | Detailed handoff planning | Strong planning model suitable for lower-strength executor handoff |
| `task-lead` | Bounded execution | Mid-to-high tier implementation model as the default/fallback executor |
| `explore` | Fast retrieval | Fast and cheap mini/flash/highspeed model |
| `librarian` | Fast research | Fast and cheap documentation/research model |
| `plan-review` | Critical review | Strong reasoning review model |
| `result-review` | Result verification | Strong reasoning verification model |

Task Lead profiles are selected from `plan.subtasks[].attributes`. They **do not** add real agents; they only configure dispatch metadata for the single hidden `task-lead` agent. Current profile models are used as recommendation/fallback metadata unless the runtime supports per-task model override.

| Profile | Matching attributes | Recommendation Direction |
| --- | --- | --- |
| `quick` | `quick` | Fastest low-cost model |
| `code` | `code` | Strong code implementation model |
| `research` | `research`, `docs` | Fast research/documentation lookup model |
| `writing` | `writing` | Documentation and explanatory writing model |
| `visual` | `multimodal`, `visual` | Visual-capable or strong UI reasoning model |
| `deep` | `deep`, `large-context` | Stronger long-context reasoning model |
| `risk-high` | `risk-high`, `security`, `migration` | Strong cautious reasoning model for high-risk changes |

Manual adjustments can only write models that exist in the imported pool, for example:

```text
bounded_lite_model_config({ action: "apply", assignments: { "command-lead": "openai/gpt-5.4", "explore": "openai/gpt-5.4-mini" } })
```

The command writes role model settings to `<configDir>/oh-my-lite-openagent.json` and regenerates `<configDir>/agents/*.md` so OpenCode can load the selected model from markdown agent frontmatter. It does not write `agent.<role>.model` into `opencode.json`. By default, it rejects models outside the imported pool to prevent AI from inventing provider/model IDs.

You can also configure reasoning effort. Oh My Lite accepts common values and aliases such as `minimal`, `low`, `medium`, `high`, `xhigh`, `extra-high`, `max`, and `maximum`. Invalid values fall back to the role/profile default; unsupported provider/model values are downgraded to a safe supported value or omitted so the provider uses its default.

```text
bounded_lite_model_config({
  action: "apply",
  assignments: { "command-lead": "openai/gpt-5.4" },
  reasoningEffortAssignments: { "command-lead": "max" }
})
```

The same command can also preview and write Task Lead profile models without adding real agents. Profiles are selected from `plan.subtasks[].attributes`; currently they are used as dispatch metadata unless the runtime supports per-task model override:

```text
bounded_lite_model_config({ action: "apply", taskLeadProfileAssignments: { "code": "opencode/claude-sonnet-4-6", "quick": "opencode-go/minimax-m2.7-highspeed" } })
```

Built-in profiles include `quick`, `code`, `research`, `writing`, `visual`, `deep`, and `risk-high`.

You can also write role models and profile models together:

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

## Agent List

| Agent | Visible | Mode | Purpose |
| --- | --- | --- | --- |
| `command-lead` | yes | `primary` | Default execution orchestration |
| `plan-builder` | yes | `all` | Planning and plan skeleton convergence |
| `deep-plan-builder` | yes | `all` | Deep planning with mandatory plan review |
| `task-lead` | no | `subagent` | Single bounded delegated task |
| `explore` | no | `subagent` | Local read-only exploration |
| `librarian` | no | `subagent` | External documentation and OSS reference lookup |
| `plan-review` | no | `subagent` | Plan artifact review |
| `result-review` | no | `subagent` | Optional review of Command Lead execution results |
| `build` | no | `subagent` | Disabled OpenCode built-in mode override |
| `plan` | no | `subagent` | Disabled OpenCode built-in mode override |

## Common Commands

```bash
npm test
npm run typecheck
npm run build
npm run install:opencode
```

## Uninstall

The installer writes a backup before modifying global config:

```text
opencode.json.bak
opencode.jsonc.bak
oh-my-lite-openagent.json.bak
agents/<role>.md.bak
```

Restore the file that was active in the installer output. If the installer reported `opencode.json`, restore `opencode.json`; if it reported `opencode.jsonc`, restore `opencode.jsonc`.

Restore on Linux/macOS:

```bash
cp ~/.config/opencode/opencode.json.bak ~/.config/opencode/opencode.json
# If your active config is JSONC:
cp ~/.config/opencode/opencode.jsonc.bak ~/.config/opencode/opencode.jsonc
# If you also want to restore role/profile model settings:
cp ~/.config/opencode/oh-my-lite-openagent.json.bak ~/.config/opencode/oh-my-lite-openagent.json
```

Restore on Windows PowerShell:

```powershell
Copy-Item "$env:APPDATA\opencode\opencode.json.bak" "$env:APPDATA\opencode\opencode.json" -Force
# If your active config is JSONC:
Copy-Item "$env:APPDATA\opencode\opencode.jsonc.bak" "$env:APPDATA\opencode\opencode.jsonc" -Force
# If you also want to restore role/profile model settings:
Copy-Item "$env:APPDATA\opencode\oh-my-lite-openagent.json.bak" "$env:APPDATA\opencode\oh-my-lite-openagent.json" -Force
```

Role markdown agent backups live next to the generated agent files as `agents/<role>.md.bak`; restore only the roles you intentionally want to roll back.

Remove local development artifacts:

```bash
rm -rf node_modules dist
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force node_modules, dist
```

## Troubleshooting

### `Invalid tools[n].name`

Use the current plugin version. Tool names must not contain dots. Valid tool names are:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_plan_artifact
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

### OpenCode Still Enters Normal Build/Plan

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

### Plugin Only Works in This Repository

You may only be using the project-local config and have not installed it globally. Run:

```bash
npm run install:opencode
```

## Current Status

- Linux: verified.
- Windows: designed for `%APPDATA%\opencode`, but not yet verified on a real Windows machine in this repository.
- OpenCode version tested in this environment: `1.4.6`.

## Design Rules

- Keep the system bounded.
- Do not add a fourth visible mode.
- Do not turn hidden subagents into autonomous control planes.
- Each role's todo list is only that role's working memory and does not replace canonical state or artifact records.
- Keep Result Review optional and limited to Command Lead-owned execution summaries.
- Delegated tasks must be explicit and bounded; do not use hidden initiator markers, and do not request whole-repo unbounded searches.
- Plugin tool names must be provider-compatible: `^[a-zA-Z0-9_-]+$`.
- Preserve the user's provider, model, and API configuration during installation.
