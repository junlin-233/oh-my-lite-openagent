# AI Installation Guide

Install and configure Oh My Lite OpenAgent for OpenCode.

Repository:

```text
https://github.com/junlin-233/oh-my-lite-openagent
```

## Goal

Make Oh My Lite OpenAgent work globally for OpenCode with the best model for each role.

After installation, the user should be able to run `opencode` from any directory and get `command-lead` as the default agent with the plugin tools loaded, and each role should have an appropriate model assigned.

## Step 1: Install

This repository does not ship a root `opencode.json`. The installer merges only the plugin-managed config fragment from `scripts/managed-config.mjs`; user-specific provider, model, API key, unrelated plugin, and custom agent settings must remain in the user's own OpenCode config.

If installing from npm or `npx`, warn the user that the downloaded npm package may lag behind the latest repository `main` branch. For the newest documented behavior, prefer the source install below or confirm the published version with `npm view oh-my-lite-openagent version`.

Before running the installer, do this preflight check in the target OpenCode config directory:

1. Resolve the config directory using this priority: `OPENCODE_CONFIG_DIR`, then `--config-dir` if the user supplies one, then the OpenCode platform default.
2. Check for both `opencode.json` and `opencode.jsonc`.
3. If both exist, `opencode.json` is the active merge target and `opencode.jsonc` is left untouched.
4. If only `opencode.jsonc` exists, the installer must merge into `opencode.jsonc` and must not create a new `opencode.json`.
5. If neither exists, the installer may create `opencode.json`.

```bash
git clone https://github.com/junlin-233/oh-my-lite-openagent.git
cd oh-my-lite-openagent
npm install
npm run install:opencode
```

If the repository already exists, open it and run:

```bash
npm install
npm run install:opencode
```

## Step 2: Configure Model Providers

After installing, you MUST configure models for each role. Ask the user:

**"Which AI model providers do you have access to? You can select multiple:"**

- Anthropic (Claude) — Claude Opus, Sonnet, Haiku
- OpenAI (ChatGPT) — GPT-5.4, GPT-4o, etc.
- Google (Gemini) — Gemini Pro, Flash
- GitHub Copilot — Copilot models
- OpenCode Zen (opencode/ models)
- OpenCode Go (opencode-go/ models like Kimi, MiniMax, GLM)
- Kimi For Coding (kimi-for-coding)
- Vercel AI Gateway

Once the user answers, call `bounded_lite_model_config` with `action=import` inside the OpenCode session. This imports every provider OpenCode can discover, including subscription providers such as `opencode` and `opencode-go`, without writing config. Then call `action=auto` to generate recommendations for each role and Task Lead profile based on capability needs:

| Role              | Capability        | Best models in priority order                                                                       |
|-------------------|-------------------|------------------------------------------------------------------------------------------------------|
| command-lead      | orchestration     | strongest imported reasoning model |
| plan-builder      | planning          | strongest imported structured planning model |
| deep-plan-builder | advisory-planning | strong imported planning model with mandatory review |
| task-lead         | execution         | capable imported implementation model |
| explore           | fast-retrieval    | fast/cheap imported mini, flash, or highspeed model |
| librarian         | fast-retrieval    | fast/cheap imported mini, flash, or highspeed model |
| plan-review       | critical-review   | strongest imported review model |
| result-review     | critical-review   | strongest imported review model |

Example call:

```
bounded_lite_model_config({ action: "import" })
bounded_lite_model_config({ action: "auto" })
```

`action=auto` is preview-only and must not write config. Show the recommendations to the user, ask whether they want to adjust any role, then apply with `action=apply` using only model IDs returned by `action=import`:

```
bounded_lite_model_config({
  action: "apply",
  assignments: { "command-lead": "openai/gpt-5.4", "explore": "openai/gpt-5.4-mini" },
  taskLeadProfileAssignments: { "code": "opencode/claude-sonnet-4-6", "quick": "opencode-go/minimax-m2.7-highspeed" }
})
```

Task Lead profiles (`quick`, `code`, `research`, `writing`, `visual`, `deep`, `risk-high`) do not create new agents; they configure dispatch metadata for the single hidden `task-lead` agent.

## Step 3: Verify

Run:

```bash
opencode debug config
opencode debug agent command-lead
```

Confirm:

- `default_agent` is `command-lead`.
- `command-lead` is `native: false`.
- `command-lead` mode is `primary`.
- `command-lead` tools include `bounded_lite_route`.
- `command-lead` tools include `bounded_lite_plan_dag`.
- `command-lead` tools include `bounded_lite_plan_readiness`.
- `command-lead` tools include `bounded_lite_background`.
- `command-lead` tools include `bounded_lite_runtime_profile`.
- `command-lead` tools include `bounded_lite_model_config`.
- `/agent-models` is registered in OpenCode commands.
- `build` mode is `subagent`.
- `plan` mode is `subagent`.

Then check model assignments:

```bash
opencode debug config
```

Each role should have a `model` field with the best available `provider/model` assignment.

## Safety Rules

- Preserve the user's existing OpenCode provider config.
- Preserve the user's existing model setting (unless the user explicitly changes it via this command).
- Preserve API keys and never print them.
- Preserve unrelated plugins.
- Preserve custom agents.
- Preserve the existing OpenCode config filename when possible: update `opencode.jsonc` when it is the only existing config file.
- Do not overwrite the whole OpenCode config.
- Do not silently create `opencode.json` when the user already has only `opencode.jsonc`.
- Do not delete user files.
- Role bash permissions default to `allow` for ordinary commands and `ask` for dangerous or sensitive commands such as destructive file operations, privileged system commands, git history/remote mutations, npm publishing/removal/versioning, real installer writes, and download-then-execute patterns. The disabled built-in `build` and `plan` overrides remain fully denied.

## If Something Fails

If OpenCode reports invalid tool names, make sure plugin tools use only these names:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

If OpenCode reports invalid permission config, check:

- `webfetch` and `websearch` must be scalar strings like `"allow"` or `"deny"`.
- Task catch-all deny rules must come before specific allow rules.
- Bash catch-all allow rules must come before specific ask rules, because OpenCode uses last matching rule wins.

If the plugin only works inside this repository, rerun:

```bash
npm run install:opencode
```

Then verify from another directory:

```bash
cd /tmp
opencode debug config
opencode debug agent command-lead
```

If model auto-configuration did not cover all roles, use `/agent-models` in OpenCode. Call `bounded_lite_model_config` with `action=import` to inspect the eligible inferred pool, then `action=apply` with specific assignments from that pool.

## How /agent-models Works

Inside OpenCode, type `/agent-models`. The command-lead agent will call `bounded_lite_model_config` with one of four actions:

- **`action=import`**: Read all discovered provider models without writing config.
- **`action=auto`**: Generate recommended role assignments and Task Lead profile assignments only (no config write).
- **`action=list`**: Show every role's current model, Task Lead profile model, and all discovered models.
- **`action=apply`**: Manually assign specific imported models. Example: `{ action: "apply", assignments: { "command-lead": "openai/gpt-5.4" }, taskLeadProfileAssignments: { "code": "opencode/claude-sonnet-4-6" } }`

## Success Condition

Installation and model configuration is complete when:

1. `opencode debug agent command-lead` shows `native: false` and all `bounded_lite_*` tools are present.
2. Each role has a `model` field in `opencode debug config` matching one of the user's available provider models.
