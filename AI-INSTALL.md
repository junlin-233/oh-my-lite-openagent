# AI Installation Guide

Install and configure Oh My Lite OpenAgent for OpenCode.

Repository:

```text
https://github.com/junlin-233/oh-my-lite-openagent
```

## Goal

Make Oh My Lite OpenAgent work globally for OpenCode with the best model for each role.

After installation, the user should be able to run `opencode` from any directory and get `command-lead` as the default agent with the plugin tools loaded, `/go` and `/agent-models` registered as managed commands, and each role should have an appropriate model assigned.

## Step 1: Install

This repository does not ship a root `opencode.json`. The installer merges only the plugin-managed config fragment from `scripts/managed-config.mjs`; user-specific provider, model, API key, unrelated plugin, and custom agent settings must remain in the user's own OpenCode config. Managed role definitions are generated as markdown files under `<configDir>/agents/*.md`; stale managed role definitions are removed from `opencode.json`, while custom agents are preserved.

If installing from npm or `npx`, warn the user that the downloaded npm package may lag behind the latest repository `main` branch. For the newest documented behavior, prefer the source install below or confirm the published version with `npm view oh-my-lite-openagent version`.

Before running the installer, do this preflight check in the target OpenCode config directory:

1. Resolve the config directory using this priority: `OPENCODE_CONFIG_DIR`, then `--config-dir` if the user supplies one, then the OpenCode platform default.
2. Check for both `opencode.json` and `opencode.jsonc`.
3. If both exist, `opencode.json` is the active merge target and `opencode.jsonc` is left untouched.
4. If only `opencode.jsonc` exists, the installer must merge into `opencode.jsonc` and must not create a new `opencode.json`.
5. If neither exists, the installer may create `opencode.json`.
6. Backups are written only for target files that already exist; do not expect empty `.bak` files for first-time generated files.

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
- `command-lead` tools include `bounded_lite_plan_artifact`.
- `command-lead` tools include `bounded_lite_background`.
- `command-lead` tools include `bounded_lite_runtime_profile`.
- `command-lead` tools include `bounded_lite_model_config`.
- `/agent-models` is registered in OpenCode commands.
- `/go` is registered in OpenCode commands and targets `command-lead`.
- Managed zero-secret MCP defaults include `context7` and `playwright`, unless installation used `--no-managed-mcp`.
- `build` mode is `subagent`.
- `plan` mode is `subagent`.

Generated `<configDir>/agents/*.md` files are managed outputs. Durable role model and reasoning settings should be changed through `/agent-models`, OpenCode config, or the installer rather than hand-editing generated agent markdown.

The managed plugin hooks and tool handlers are async-compatible. JSON-shaped tool results, such as route resolution or runtime profile output, are returned as formatted JSON strings for stable provider/tool transport behavior.

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
- Preserve unrelated MCP servers and user-defined `context7`/`playwright` MCP entries.
- Preserve custom agents.
- Preserve user runtime/control preferences: do not persist `reasoningEffort` unless the user explicitly requests it through `reasoningEffortAssignments`; OpenCode session choices such as `Ctrl+T` remain in control.
- For any new Task tool subagent call, omit `task_id` entirely. Pass `task_id` only when resuming a real prior returned task id; never pass an empty string, placeholder, null-like value, or fabricated id.
- Remove stale Oh My Lite managed role definitions from `opencode.json`; the active role definitions live in generated markdown agent files under `<configDir>/agents/*.md`.
- Preserve the existing OpenCode config filename when possible: update `opencode.jsonc` when it is the only existing config file.
- Do not overwrite the whole OpenCode config.
- Do not silently create `opencode.json` when the user already has only `opencode.jsonc`.
- Do not delete user files.
- Role bash permissions default to `allow` for ordinary commands and `ask` for dangerous or sensitive commands such as destructive file operations, privileged system commands, git history/remote mutations, npm publishing/removal/versioning, real installer writes, and download-then-execute patterns. This policy lives in global `permission.bash`: if the user has a custom `permission` object without `bash`, backfill the managed bash policy while preserving the user's other permission settings; if the user already has `permission.bash`, preserve it. The disabled built-in `build` and `plan` overrides remain fully denied.

## If Something Fails

If OpenCode reports invalid tool names, make sure plugin tools use only these names:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_plan_readiness
bounded_lite_plan_artifact
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

## How /go Works

Inside OpenCode, type `/go <goal>`. The command sends `$ARGUMENTS` to `command-lead` as a non-interactive Go Protocol workflow. Command Lead should infer practical acceptance criteria from the goal and repository conventions, gather scoped evidence, choose the lightest safe strategy, implement or delegate bounded work, verify the result, and continue until acceptance passes or a hard blocker is reached.

`/go` is a workflow command, not a new mode or agent. It must not commit, push, publish, perform destructive actions, or write external/user-local OpenCode config unless the user explicitly requests and authorizes that action.

## Planning Questions

The visible decision-making roles (`command-lead`, `plan-builder`, and `deep-plan-builder`) may use OpenCode's `Question tool` for bounded blocking choices. Plan Builder and Deep Plan Builder should present 2-5 concrete options, include a recommended option when evidence supports one, include `Custom / other` when user-supplied input is valid, and record user-confirmed decisions in the plan artifact when they affect scope, acceptance, or strategy.

## Success Condition

Installation and model configuration is complete when:

1. `opencode debug agent command-lead` shows `native: false` and all `bounded_lite_*` tools are present.
2. `/go` and `/agent-models` are available as OpenCode commands.
3. Each role has a `model` field in `opencode debug config` matching one of the user's available provider models.
