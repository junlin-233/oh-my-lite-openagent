# AI Installation Guide

Install and configure Oh My Lite OpenAgent for OpenCode.

Repository:

```text
https://github.com/junlin-233/oh-my-lite-openagent
```

## Goal

Make Oh My Lite OpenAgent work globally for OpenCode.

After installation, the user should be able to run `oc` from any directory and get `command-lead` as the default agent with the plugin tools loaded.

## Do This

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

## Verify

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

## Safety Rules

- Preserve the user's existing OpenCode provider config.
- Preserve the user's existing model setting.
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

## Success Condition

Installation is complete when `oc debug agent command-lead` shows `native: false` and all `bounded_lite_*` tools are present.
