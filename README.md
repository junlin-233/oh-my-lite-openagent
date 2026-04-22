# Oh My Lite OpenAgent

[English](./README.md) | [简体中文](./README.zh-CN.md)

A small, installable OpenCode orchestration layer.

It gives OpenCode a default command lead, two planning modes, bounded subagents, safe plugin tools, and a global installer that works from any project directory after setup.

This is intentionally lighter than Oh My OpenAgent. No giant runtime, no model lock-in, no hidden autonomous control plane. Just a bounded OpenCode plugin that is easy to inspect, install, and remove.

## What You Get

- `command-lead`: the default execution orchestrator.
- `plan-builder`: visible planning mode for requirements and plan skeletons.
- `power-plan-builder`: visible deep planning mode for execution-grade plans.
- `task-lead`, `explore`, `librarian`, `review`: hidden bounded subagents.
- Provider-safe plugin tools: `bounded_lite_route`, `bounded_lite_background`, `bounded_lite_runtime_profile`.
- OpenCode native `build` and `plan` modes hidden behind disabled overrides.
- A global installer that preserves your existing model, provider, API key, plugins, and custom agents.

## Quick Start

### Install

```bash
git clone https://github.com/junlin-233/oh-my-lite-openagent.git
cd oh-my-lite-openagent
npm install
npm run install:opencode
```

### Start OpenCode

```bash
oc
```

After installation, the plugin is global. You can run `oc` from any project directory.

### Verify

```bash
oc debug config
oc debug agent command-lead
```

`command-lead` should be `native: false` and should include:

```text
bounded_lite_route
bounded_lite_background
bounded_lite_runtime_profile
```

## AI Install

Copy and paste this prompt to your LLM agent (Claude Code, AmpCode, Cursor, etc.):

```text
Install and configure Oh My Lite OpenAgent for OpenCode:
https://raw.githubusercontent.com/junlin-233/oh-my-lite-openagent/main/README.md

Follow the README Quick Start. Preserve my existing OpenCode provider, model, API keys, plugins, and custom agents. After installation, verify with `oc debug config` and `oc debug agent command-lead`.
```

Detailed AI maintainer instructions live in [`AI-INSTRUCTIONS.md`](./AI-INSTRUCTIONS.md).

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
node scripts/install.mjs --dry-run
```

## Agent Map

| Agent | Visible | Mode | Purpose |
| --- | --- | --- | --- |
| `command-lead` | yes | `primary` | Default execution orchestrator |
| `plan-builder` | yes | `all` | Planning and skeleton convergence |
| `power-plan-builder` | yes | `all` | Deep planning from a stable skeleton |
| `task-lead` | no | `subagent` | One bounded delegated task |
| `explore` | no | `subagent` | Local read-only exploration |
| `librarian` | no | `subagent` | External docs and OSS lookup |
| `review` | no | `subagent` | Plan and execution review |
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
bounded_lite_background
bounded_lite_runtime_profile
```

### OpenCode still starts in normal Build/Plan

Run:

```bash
npm run install:opencode
oc debug config
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
- Keep plugin tool names provider-safe: `^[a-zA-Z0-9_-]+$`.
- Preserve user provider/model/API configuration during install.
