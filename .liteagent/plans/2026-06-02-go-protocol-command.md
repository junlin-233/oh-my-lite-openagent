---
plan_schema_version: 2.1
plan_id: go-protocol-command-20260602
title: Add /go agentic goal workflow command
maturity_level: M2
status: draft
repo_snapshot_ref: 57640a2
generated_by: plan_builder
updated_at: 2026-06-02T10:01:27Z
recommended_plan_path: .liteagent/plans/2026-06-02-go-protocol-command.md
---

## goals

- Add a managed `/go` command that starts a non-interactive, agentic goal-completion workflow through `command-lead`.
- Cover the full development loop: goal intake, evidence gathering, strategy selection, implementation, verification, and closure.
- Preserve the repository's bounded architecture: no new visible mode, no new real role, no second orchestrator layer.

## scope_boundaries

in:
- Register `/go` in `scripts/managed-config.mjs` as a managed command targeting `command-lead`.
- Add Go Protocol instructions to `.opencode/agents/command-lead.md`.
- Add or update tests that lock command registration and key prompt behavior.
- Document `/go` usage in `README.md` and `README.zh-CN.md`.

out:
- Do not add a fourth visible mode or a new `goal` / `go` agent.
- Do not change the fixed role set in `.opencode/lib/contracts.ts`.
- Do not change provider, model, API key, or user-local OpenCode configuration behavior.
- Do not add automatic git commit, push, publish, or external config writes.

## assumptions

- [User Confirmed] `/go` users intend a sufficiently clear goal and want autonomous progress until completion, regardless of duration, without clarification or preference questions.
- [Repo Observed] Managed commands are defined in `scripts/managed-config.mjs` under `MANAGED_CONFIG.command`.
- [Repo Observed] The visible architecture is fixed to `execution`, `planning`, and `deep-planning`; real roles are fixed to eight bounded roles.

## decisions

- Implement `/go` as a command-level workflow that invokes `command-lead`, not as a new OpenCode `mode` or agent. This preserves existing contracts and tests.
- Use `$ARGUMENTS` as the official OpenCode custom command placeholder for the user-supplied goal.
- Make `/go` non-interactive by default: infer reasonable acceptance criteria from repository conventions and keep working until the goal is complete; do not ask clarification or preference questions mid-flow.
- Keep safety gates: sensitive surfaces still require repository evidence, destructive or external actions remain blocked unless explicitly requested.
- For safety/permission hard blockers, stop with a blocked report that names the missing explicit authorization or impossible condition instead of starting an interactive clarification loop.

## phase_plan

1. Command registration: add a `/go` managed command template that frames the user argument as a Go Protocol goal for `command-lead`.
2. Orchestration prompt: extend `command-lead.md` with Go Protocol rules for non-interactive goal intake, evidence, planning, delegation, verification, completion persistence, and blocked reports.
3. Tests: add coverage for `/go` command registration and key non-interactive protocol wording while preserving visible mode and role-count invariants.
4. Documentation: add concise `/go` examples and behavior notes to English and Chinese READMEs.
5. Verification: run the relevant config/runtime tests, full test suite, typecheck, and installer dry-run.

## acceptance_criteria

- `scripts/managed-config.mjs` registers `command.go` with `agent: "command-lead"` and a template that frames `$ARGUMENTS` as the user's goal.
- `command-lead.md` documents Go Protocol as non-interactive goal-completion mode, requires continuing until verification/acceptance succeeds, prohibits clarification/preference questions during the workflow, and includes hard-blocker report behavior.
- Tests confirm `/go` is registered without changing the three visible modes or eight real roles.
- README documentation shows how to use `/go <goal>` and explains that it does not commit, push, publish, or write external config unless explicitly requested.
- Verification commands pass:
  - `npm test`
  - `npm run typecheck`
  - `node scripts/install.mjs --dry-run`

## risks

- Risk: `/go` may become too autonomous and perform unwanted broad edits. Mitigation: scope Go Protocol to repository-consistent defaults, sensitive-surface evidence gates, and no destructive/external actions without explicit request.
- Risk: command template wording may duplicate or conflict with existing routing rules. Mitigation: add the protocol as an override only for `/go`, while preserving Command Lead authority and routing constraints.
- Risk: docs may imply a new mode. Mitigation: consistently call it a command or workflow, not an OpenCode mode.

## evidence

- `scripts/managed-config.mjs`: existing managed command `agent-models` is registered under `MANAGED_CONFIG.command` and targets `command-lead`.
- `.opencode/agents/command-lead.md`: Command Lead owns routing, approval, artifact submission, execution readiness, and final acceptance.
- `.opencode/lib/contracts.ts`: `VISIBLE_MODES` is fixed to `execution`, `planning`, `deep-planning`; `ROLE_CONTRACTS` contains eight real roles.
- `tests/config/agents.test.ts`: tests assert exactly three visible user-facing modes, fixed role layout, and managed command behavior.
- `https://opencode.ai/docs/commands`: OpenCode custom command templates support `$ARGUMENTS` for command arguments and require `template` in config-defined commands.

## plan

```yaml
plan:
  subtasks:
    - id: register-go-command
      depends_on: []
      attributes: [code]
      deliverable: `scripts/managed-config.mjs` registers `/go` as a managed `command-lead` command with a Go Protocol template.
      description: Add the command entry without removing or weakening `agent-models`; ensure the template frames `$ARGUMENTS` as the user goal.
    - id: add-command-lead-go-protocol
      depends_on: [register-go-command]
      attributes: [writing, code]
      deliverable: `.opencode/agents/command-lead.md` contains Go Protocol instructions for non-interactive goal completion.
      description: Define goal intake, evidence pass, strategy selection, implementation/delegation, verification loop, completion persistence without clarification questions, closure summary, and blocked-report behavior.
    - id: add-go-command-tests
      depends_on: [register-go-command, add-command-lead-go-protocol]
      attributes: [code]
      deliverable: Tests cover `/go` registration and key protocol invariants while preserving existing architecture tests.
      description: Update `tests/config/agents.test.ts` and any smoke checks such as `scripts/test-features.mjs` if needed.
    - id: document-go-command
      depends_on: [add-command-lead-go-protocol]
      attributes: [docs, writing]
      deliverable: `README.md` and `README.zh-CN.md` document `/go <goal>` usage and safety boundaries.
      description: Add concise examples and clarify that `/go` is a workflow command, not a new OpenCode mode.
    - id: verify-go-command
      depends_on: [add-go-command-tests, document-go-command]
      attributes: [quick]
      deliverable: Verification results for `npm test`, `npm run typecheck`, and `node scripts/install.mjs --dry-run`.
      description: Run required checks and fix any failures within the planned scope.
```
