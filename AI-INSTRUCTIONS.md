# AI Maintainer Guide

This file is for AI coding agents working in this repository. The human-facing install and usage guide is `README.md`.

## Mission

Maintain a lightweight OpenCode plugin that can be installed globally and then work from any project directory.

The project must stay small, inspectable, and bounded. It is inspired by Oh My OpenAgent's install-and-go workflow, but it is not a full clone and must not grow into a large autonomous harness.

## Source Of Truth

- Architecture: `docs/架构总览.md`
- OpenCode config: `opencode.json`
- Plugin runtime: `.opencode/plugins/bounded-lite.ts`
- Agent prompts: `.opencode/agents/*.md`
- Runtime contracts: `.opencode/lib/contracts.ts`
- Installer: `scripts/install.mjs`
- Tests: `tests/`

## Install Behavior

`npm run install:opencode` runs `scripts/install.mjs`.

The installer must:

- Copy `.opencode/agents`, `.opencode/plugins`, and `.opencode/lib` into the OpenCode global config directory.
- Never copy `.opencode/node_modules`.
- Merge global `opencode.json`, not replace it wholesale.
- Preserve user `model`, `provider`, API keys, existing plugins, and custom agents.
- Append or refresh this plugin entry: `["./.opencode/plugins/bounded-lite.ts", { "mode": "full" }]`.
- Set `default_agent` to `command-lead`.
- Keep OpenCode built-in `build` and `plan` hidden as disabled `subagent` overrides.

Default global config directories:

- Linux/macOS: `$XDG_CONFIG_HOME/opencode`, otherwise `~/.config/opencode`
- Windows: `%APPDATA%\opencode`

## Agent Topology

Visible user-facing agents:

- `command-lead`: default primary execution orchestrator.
- `plan-builder`: visible planner and internal normalize planner.
- `power-plan-builder`: visible deep planner for stable skeletons.

Hidden internal agents:

- `task-lead`
- `explore`
- `librarian`
- `review`

Disabled built-in overrides:

- `build`
- `plan`

Do not add another visible mode unless the architecture document and tests are deliberately updated.

## Plugin Tool Rules

Tool names must match:

```text
^[a-zA-Z0-9_-]+$
```

Current valid tool names:

- `bounded_lite_route`
- `bounded_lite_background`
- `bounded_lite_runtime_profile`

Do not use dots in tool names. Names like `bounded-lite.route` break some model provider APIs.

## Verification

Run these after code changes:

```bash
npm test
npm run typecheck
```

Run this after installer/config/plugin changes:

```bash
npm run install:opencode
oc debug config
oc debug agent command-lead
```

Expected `oc debug agent command-lead` facts:

- `native: false`
- `mode: primary`
- tools include `bounded_lite_route`
- tools include `bounded_lite_background`
- tools include `bounded_lite_runtime_profile`

## Config Safety

Global user config may contain secrets. Never print or quote API keys in summaries.

When editing `/root/.config/opencode/opencode.json` or equivalent global config:

- Preserve unrelated plugins.
- Preserve provider config.
- Preserve model selection.
- Preserve custom user agents.
- Back up before writing.

## Development Constraints

- Use `rg` for search.
- Use `apply_patch` for manual edits.
- Do not revert user changes unless explicitly requested.
- Keep docs and tests aligned with config behavior.
- Keep README human-facing and concise.
- Keep this file AI-facing and operational.

## Common Failure Modes

If OpenCode reports invalid permission config:

- Check web permissions. `webfetch` and `websearch` must be scalar strings like `"allow"` or `"deny"`.
- Check task rule ordering. OpenCode uses last-match-wins semantics, so task catch-all denies must come before specific allows.

If OpenCode reports invalid tool name:

- Search for dotted tool names.
- Replace them with `bounded_lite_*` names.
- Verify with `oc debug agent command-lead`.

If the plugin only works inside this repository:

- The global installer was not run or wrote to a different config directory.
- Run `npm run install:opencode`.
- Check `oc debug config` from `/tmp` or another non-repository directory.
