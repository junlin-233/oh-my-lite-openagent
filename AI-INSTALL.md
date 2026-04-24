# AI Installation Guide

Install and configure Oh My Lite OpenAgent for OpenCode.

Repository:

```text
https://github.com/junlin-233/oh-my-lite-openagent
```

## Goal

Make Oh My Lite OpenAgent work globally for OpenCode with the best model for each role.

After installation, the user should be able to run `oc` from any directory and get `command-lead` as the default agent with the plugin tools loaded, and each role should have an appropriate model assigned.

## Step 1: Install

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

Once the user answers, call `bounded_lite_model_config` with `action=auto` inside the OpenCode session. This automatically reads available provider models and assigns the best one to each role based on role capability needs:

| Role              | Capability        | Best models in priority order                                                                       |
|-------------------|-------------------|------------------------------------------------------------------------------------------------------|
| command-lead      | orchestration     | Claude Opus → GPT-5.4 → Gemini Pro → Claude Sonnet → Kimi K2 → GPT-4o → GLM-5 → MiniMax → big-pickle |
| plan-builder      | planning          | Claude Opus → GPT-5.4 → Gemini Pro → Claude Sonnet → Kimi K2 → GPT-4o → GLM-5 → MiniMax → big-pickle |
| deep-plan-builder | advisory-planning | Claude Sonnet → Kimi K2 → Gemini Flash → GPT-5.4 → Claude Opus → GPT-4o → Codex → GLM-5 → MiniMax → big-pickle |
| task-lead         | execution         | Claude Sonnet → Kimi K2 → GPT-5.4 → Gemini Pro → GPT-4o → Codex → MiniMax → GPT-5-nano → big-pickle |
| explore           | fast-retrieval    | GPT-5.4-mini → Claude Haiku → MiniMax HighSpeed → MiniMax → Gemini Flash → GPT-5-nano → big-pickle |
| librarian         | fast-retrieval    | GPT-5.4-mini → Claude Haiku → MiniMax HighSpeed → MiniMax → Gemini Flash → GPT-5-nano → big-pickle |
| plan-review       | critical-review   | GPT-5.4 → Claude Opus → Gemini Pro → Claude Sonnet → GPT-4o → GLM-5 → MiniMax → big-pickle |
| result-review     | critical-review   | GPT-5.4 → Claude Opus → Gemini Pro → Claude Sonnet → GPT-4o → GLM-5 → MiniMax → big-pickle |

Example call:

```
bounded_lite_model_config({ action: "auto" })
```

If `action=auto` doesn't cover all roles (e.g., some providers aren't detected), manually assign models using `action=apply`:

```
bounded_lite_model_config({ action: "apply", assignments: { "command-lead": "anthropic/claude-opus-4-7", "explore": "openai/gpt-5.4-mini" } })
```

## Step 3: Verify

Run:

```bash
oc debug config
oc debug agent command-lead
```

Confirm:

- `default_agent` is `command-lead`.
- `command-lead` is `native: false`.
- `command-lead` mode is `primary`.
- `command-lead` tools include `bounded_lite_route`.
- `command-lead` tools include `bounded_lite_plan_dag`.
- `command-lead` tools include `bounded_lite_background`.
- `command-lead` tools include `bounded_lite_runtime_profile`.
- `command-lead` tools include `bounded_lite_model_config`.
- `/Character-model` is registered in OpenCode commands.
- `build` mode is `subagent`.
- `plan` mode is `subagent`.

Then check model assignments:

```bash
oc debug config
```

Each role should have a `model` field with the best available `provider/model` assignment.

## Safety Rules

- Preserve the user's existing OpenCode provider config.
- Preserve the user's existing model setting (unless the user explicitly changes it via this command).
- Preserve API keys and never print them.
- Preserve unrelated plugins.
- Preserve custom agents.
- Do not overwrite the whole OpenCode config.
- Do not delete user files.

## If Something Fails

If OpenCode reports invalid tool names, make sure plugin tools use only these names:

```text
bounded_lite_route
bounded_lite_plan_dag
bounded_lite_background
bounded_lite_runtime_profile
bounded_lite_model_config
```

If OpenCode reports invalid permission config, check:

- `webfetch` and `websearch` must be scalar strings like `"allow"` or `"deny"`.
- Task catch-all deny rules must come before specific allow rules.

If the plugin only works inside this repository, rerun:

```bash
npm run install:opencode
```

Then verify from another directory:

```bash
cd /tmp
oc debug config
oc debug agent command-lead
```

If model auto-configuration did not cover all roles, use `/character model` in OpenCode. Call `bounded_lite_model_config` with `action=list` to see what's available, then `action=apply` with specific assignments.

## How /character model Works

Inside OpenCode, type `/character model`. The command-lead agent will call `bounded_lite_model_config` with one of three actions:

- **`action=auto`**: Read available provider models and assign the best one to each role automatically.
- **`action=list`**: Show every role's current model and all models available from your providers.
- **`action=apply`**: Manually assign specific models. Example: `{ action: "apply", assignments: { "command-lead": "anthropic/claude-opus-4-7", "explore": "openai/gpt-5.4-mini" } }`

## Success Condition

Installation and model configuration is complete when:

1. `oc debug agent command-lead` shows `native: false` and all `bounded_lite_*` tools are present.
2. Each role has a `model` field in `oc debug config` matching one of the user's available provider models.