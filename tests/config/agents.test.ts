import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const managedConfigModule = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/managed-config.mjs")).href
);
const config = managedConfigModule.MANAGED_CONFIG as {
  default_agent?: string;
  provider?: unknown;
  model?: unknown;
  small_model?: unknown;
  command?: Record<string, { agent?: string; template?: string; description?: string }>;
  mcp?: Record<string, { type?: string; command?: string[] }>;
  agent: Record<
    string,
    {
      mode: string;
      hidden?: boolean;
      description?: string;
      color?: string;
      prompt?: string;
      model?: string;
      permission?: Record<string, unknown>;
    }
  >;
};

describe("OpenCode agent topology", () => {
  it("starts OpenCode in the bounded command lead by default", () => {
    expect(config.default_agent).toBe("command-lead");
  });

  it("does not ship personalized provider or model configuration", () => {
    expect(config.provider).toBeUndefined();
    expect(config.model).toBeUndefined();
    expect(config.small_model).toBeUndefined();

    for (const [agentName, agent] of Object.entries(config.agent)) {
      expect(agent.model, agentName).toBeUndefined();
    }
  });

  it("registers a TUI command for role model configuration", () => {
    expect(config.command?.["agent-models"]).toMatchObject({
      agent: "command-lead",
    });
    expect(config.command?.["agent-models"]?.description).toContain("per-role");
    expect(config.command?.["agent-models"]?.description).toContain("Task Lead profile assignments");
    expect(config.command?.["agent-models"]?.template).toContain("bounded_lite_model_config");
    expect(config.command?.["agent-models"]?.template).toContain('action: "import"');
    expect(config.command?.["agent-models"]?.template).toContain(
      "includes every discovered provider",
    );
    expect(config.command?.["agent-models"]?.template).toContain("opencode-go");
    expect(config.command?.["agent-models"]?.template).toContain("action=auto is recommendation-only");
    expect(config.command?.["agent-models"]?.template).toContain("Task Lead profile recommendations");
    expect(config.command?.["agent-models"]?.template).toContain("taskLeadProfileAssignments");
    expect(config.command?.["agent-models"]?.template).toContain("Do not create new Task Lead agents");
    expect(config.command?.["agent-models"]?.template).toContain("ask whether they want changes");
  });

  it("registers a /go command for non-interactive goal completion", () => {
    expect(config.command?.go).toMatchObject({
      agent: "command-lead",
    });
    expect(config.command?.go?.description).toContain("non-interactive agentic goal workflow");
    expect(config.command?.go?.template).toContain("Go Protocol");
    expect(config.command?.go?.template).toContain("$ARGUMENTS");
    expect(config.command?.go?.template).toContain("non-interactive agentic goal-completion workflow");
    expect(config.command?.go?.template).toContain("without asking clarification or preference questions");
    expect(config.command?.go?.template).toContain("continue until verification and acceptance criteria succeed");
    expect(config.command?.go?.template).toContain("Do not commit, push, publish");
    expect(config.command?.go?.template).toContain("hard blocker");
  });

  it("registers a /study command for current-directory exam review packages", () => {
    expect(config.command?.study).toMatchObject({
      agent: "command-lead",
    });
    expect(config.command?.study?.description).toContain("final exam review project");
    expect(config.command?.study?.template).toContain("$ARGUMENTS");
    expect(config.command?.study?.template).toContain("bounded_lite_study_ingest");
    expect(config.command?.study?.template).toContain("bounded_lite_study_package");
    expect(config.command?.study?.template).toContain('stage="sources"');
    expect(config.command?.study?.template).toContain("extractionQuality");
    expect(config.command?.study?.template).toContain("pdftotext");
    expect(config.command?.study?.template).toContain("current OpenCode working directory");
    expect(config.command?.study?.template).toContain(".ppt, .pptx, and .pdf");
    expect(config.command?.study?.template).toContain("[External]");
    expect(config.command?.study?.template).toContain("AGENTS.md");
    expect(config.command?.study?.template).toContain("oh-my-lite-study:start");
    expect(config.command?.study?.template).toContain("not a new OpenCode mode or agent");
  });

  it("registers zero-secret managed MCP defaults", () => {
    expect(config.mcp?.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp"],
    });
    expect(config.mcp?.playwright).toEqual({
      type: "local",
      command: ["npx", "-y", "@playwright/mcp"],
    });
  });

  it("registers eight bounded roles plus disabled built-in overrides", () => {
    expect(Object.keys(config.agent)).toHaveLength(10);
    expect(config.agent.build).toMatchObject({ mode: "subagent", hidden: true });
    expect(config.agent.plan).toMatchObject({ mode: "subagent", hidden: true });
  });

  it("exposes exactly three visible user-facing modes", () => {
    const visibleAgents = Object.entries(config.agent)
      .filter(([, agent]) => !agent.hidden && agent.mode !== "subagent")
      .map(([name]) => name);

    expect(visibleAgents).toEqual([
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
    ]);
  });

  it("keeps the visible Tab cycle and agent marker colors stable", () => {
    const agentOrder = Object.keys(config.agent);
    const tabCycle = agentOrder
      .filter((agentName) => {
        const agent = config.agent[agentName];
        return agent && !agent.hidden && agent.mode !== "subagent";
      });

    expect(agentOrder.slice(0, 3)).toEqual([
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
    ]);
    expect(tabCycle).toEqual([
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
    ]);
    expect(nextVisibleAgent(tabCycle, "command-lead")).toBe("plan-builder");
    expect(nextVisibleAgent(tabCycle, "plan-builder")).toBe("deep-plan-builder");
    expect(nextVisibleAgent(tabCycle, "deep-plan-builder")).toBe("command-lead");
    expect(config.agent["command-lead"]?.color).toBe("#87cefa");
    expect(config.agent["deep-plan-builder"]?.color).toBe("#ff0000");
  });

  it("keeps all internal-only roles hidden", () => {
    const hiddenAgents = Object.entries(config.agent)
      .filter(([, agent]) => agent.hidden)
      .map(([name]) => name)
      .sort();

    expect(hiddenAgents).toEqual([
      "build",
      "explore",
      "librarian",
      "plan",
      "plan-review",
      "result-review",
      "task-lead",
    ]);
  });

  it("keeps planners dual-use without adding extra visible modes", () => {
    expect(config.agent["plan-builder"]?.mode).toBe("all");
    expect(config.agent["deep-plan-builder"]?.mode).toBe("all");
    expect(config.agent["plan-builder"]?.description).toContain("discussion mode");
    expect(config.agent["plan-builder"]?.description).toContain("normalize mode");
    expect(config.agent["deep-plan-builder"]?.description).toContain("mandatory plan review");
  });

  it("requires every real role prompt to maintain a local todo list", () => {
    const roleNames = Object.keys(config.agent).filter(
      (agentName) => agentName !== "build" && agentName !== "plan",
    );

    for (const roleName of roleNames) {
      const prompt = config.agent[roleName]?.prompt;
      expect(prompt, roleName).toBeDefined();

      const filePath = prompt?.match(/^\{file:(.*)\}$/)?.[1];
      expect(filePath, roleName).toBeDefined();

      const promptText = readFileSync(path.resolve(process.cwd(), filePath ?? ""), "utf8");
      expect(promptText.toLowerCase(), roleName).toContain("todo");
    }
  });

  it("prevents empty task_id delegation crashes in delegating role prompts", () => {
    const delegatingRoles = [
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "plan-review",
      "result-review",
    ];

    for (const roleName of delegatingRoles) {
      const promptText = readPrompt(roleName);
      expect(promptText, roleName).toContain("omit the Task tool `task_id` field entirely");
      expect(promptText, roleName).toContain("never pass an empty string, placeholder, null-like value, or fabricated id");
    }
  });

  it("keeps Command Lead delegation assignments explicit and bounded", () => {
    const promptText = readPrompt("command-lead");
    const requiredFields = [
      "TASK:",
      "EXPECTED OUTCOME:",
      "ROLE:",
      "SCOPE:",
      "UPSTREAM EVIDENCE:",
      "REQUIRED TOOLS:",
      "MUST DO:",
      "MUST NOT DO:",
      "CONTEXT:",
      "DELIVERABLE FORMAT:",
      "FAILURE RETURN:",
    ];

    for (const field of requiredFields) {
      expect(promptText, field).toContain(field);
    }

    expect(promptText).toContain("Do not use hidden initiator markers");
    expect(promptText).toContain("omit the Task tool `task_id` field entirely");
    expect(promptText).toContain("never pass an empty string, placeholder, null-like value, or fabricated id");
    expect(promptText).toContain("Use the smallest complete assignment");
    expect(promptText).toContain("Do not over-explain routine context");
    expect(promptText).toContain("Do not perform whole-repo unbounded search");
    expect(promptText).toContain("Result Review");
    expect(promptText).toContain("never a Task Lead child return");
    expect(promptText).not.toContain("OMO_INTERNAL_INITIATOR");
  });

  it("keeps Command Lead routing decision tree explicit", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Routing Decision Tree");
    expect(promptText).toContain("## Repository Evidence Gate");
    expect(promptText).toContain("Prefer the lightest successful path");
    expect(promptText).toContain("do not narrate obvious mechanics");
    expect(promptText).toContain("reading large files, comparing many files");
    expect(promptText).toContain("gather scoped repository evidence");
    expect(promptText).toContain("Direct local inspection is acceptable for one or two small files");
    expect(promptText).toContain("narrow role-instruction wording edits");
    expect(promptText).toContain("**Direct execution?**");
    expect(promptText).toContain("keep visible commentary minimal");
    expect(promptText).toContain("**Planning required?**");
    expect(promptText).toContain("**Deep planning explicitly required?**");
    expect(promptText).toContain("lower-strength-model handoff");
    expect(promptText).toContain("detailed execution-grade plan");
    expect(promptText).toContain("Do not choose Deep Plan Builder only because the work is complex");
    expect(promptText).toContain("Use Plan Builder as the normal planning route");
    expect(promptText).toContain("Plan Builder returns a blocking recommendation to escalate");
    expect(promptText).toContain("Do not route to planning only because a task has several mechanical steps");
    expect(promptText).not.toContain("medium or larger");
  });

  it("requires Command Lead to gate plan execution on readiness", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Plan Readiness Gate");
    expect(promptText).toContain("Do not dispatch Task Lead work from a plan that fails this gate");
    expect(promptText).toContain("maturity_level");
    expect(promptText).toContain("status");
    expect(promptText).toContain("M3");
    expect(promptText).toContain("M2");
    expect(promptText).toContain("bounded_lite_plan_readiness");
    expect(promptText).toContain("no unresolved major Plan Review finding");
    expect(promptText).toContain("do not fill missing product, compatibility, architecture, or acceptance decisions yourself");
    expect(promptText).toContain("ask the user whether to escalate to Deep Plan Builder");
    expect(promptText).toContain("Plan Builder already returned a blocking escalation recommendation");
    expect(promptText).toContain("escalate with the blockers");
  });

  it("documents Study Protocol without adding modes or agents", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Study Protocol");
    expect(promptText).toContain("bounded_lite_study_ingest");
    expect(promptText).toContain("bounded_lite_study_package");
    expect(promptText).toContain('stage: "sources"');
    expect(promptText).toContain("extractionQuality");
    expect(promptText).toContain("pdftotext");
    expect(promptText).toContain("first-level `.ppt`, `.pptx`, and `.pdf`");
    expect(promptText).toContain("courseware as the canonical source");
    expect(promptText).toContain("[External]");
    expect(promptText).toContain("source-index.json");
    expect(promptText).toContain("anki_flashcards.csv");
    expect(promptText).toContain("<!-- oh-my-lite-study:start -->");
    expect(promptText).toContain("Command Lead-owned batch summary");
    expect(promptText).toContain("LibreOffice/`soffice`");
  });

  it("requires Command Lead Go Protocol to stay non-interactive and bounded", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Go Protocol");
    expect(promptText).toContain("managed `/go` command");
    expect(promptText).toContain("non-interactive agentic goal-completion workflow");
    expect(promptText).toContain("do not ask clarification or preference questions during the workflow");
    expect(promptText).toContain("Continue through goal intake, evidence gathering, strategy selection");
    expect(promptText).toContain("verification and acceptance criteria succeed");
    expect(promptText).toContain("Do not commit, push, publish");
    expect(promptText).toContain("hard blocker prevents completion");
    expect(promptText).toContain("limited to execution, planning, and deep planning");
  });

  it("lets Command Lead present bounded user choices through the Question tool", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## User Decision Selector");
    expect(promptText).toContain("Question tool");
    expect(promptText).toContain("2-5 user-facing options");
    expect(promptText).toContain("Custom / other");
    expect(promptText).toContain("Ask at most 3 decision questions");
  });

  it("requires Command Lead to persist plan artifacts under .liteagent", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Plan Artifact Persistence");
    expect(promptText).toContain(".liteagent/plans/");
    expect(promptText).toContain(".liteagent/plan-index.jsonl");
    expect(promptText).toContain("bounded_lite_plan_artifact");
    expect(promptText).toContain("Do not write plan artifacts under `.opencode/`");
    expect(promptText).toContain("Persist user-approved plan artifacts");
    expect(promptText).toContain("only after explicit user approval to save/write/persist the plan");
    expect(promptText).toContain("deletion/removal must only happen when the user explicitly asks");
  });

  it("keeps Plan Builder aligned with the v2.1 plan spec", () => {
    const promptText = readPrompt("plan-builder");

    expect(promptText).toContain("Match the user's language");
    expect(promptText).toContain("Keep code identifiers, file paths, commands, and schema keys unchanged");
    expect(promptText).toContain("## Discussion Mode Output");
    expect(promptText).toContain("Ask at most 3 high-value blocking questions");
    expect(promptText).toContain("Do not emit full frontmatter");
    expect(promptText).toContain("## Normalize Mode Output");
    expect(promptText).toContain("Keep the skeleton proportional");
    expect(promptText).toContain("## Spec v2.1 Compliance");
    expect(promptText).toContain("plan_schema_version: 2.1");
    expect(promptText).toContain("maturity_level: M0|M1|M2|M3");
    expect(promptText).toContain("[User Confirmed]");
    expect(promptText).toContain("[Repo Observed]");
    expect(promptText).toContain("[Inferred]");
    expect(promptText).toContain("basis");
    expect(promptText).toContain("Final plan artifacts must not contain an `open_questions` section or `[Open Question]` tags");
    expect(promptText).toContain("Required compact sections");
    expect(promptText).toContain("one-to-two screen plan");
    expect(promptText).toContain("adopted assumptions");
    expect(promptText).toContain("5 clarification turns");
    expect(promptText).toContain("current-state conflicts");
    expect(promptText).toContain("target-state gaps");
    expect(promptText).toContain("must not be emitted as a final artifact");
    expect(promptText).toContain("recommended_plan_path");
    expect(promptText).toContain(".liteagent/plans/");
    expect(promptText).toContain("chat-only candidate");
    expect(promptText).toContain("lightweight overview card");
    expect(promptText).toContain("outputs, workflow, scope, risks, verification");
    expect(promptText).toContain("only after explicit user approval to save/write/persist the plan");
    expect(promptText).toContain(".liteagent/plan-index.jsonl");
    expect(promptText).toContain("Deleting plan artifact files or removing/changing index entries is allowed only when the user explicitly asks");
    expect(promptText).toContain("does not grant execution dispatch, final approval, or canonical state advancement authority");
    expect(promptText).toContain("recommended_next_step: deep_plan_builder");
    expect(promptText).toContain("## Decision Selector Discipline");
    expect(promptText).toContain("Question tool");
    expect(promptText).toContain("technology stack");
    expect(promptText).toContain("Custom / other");
    expect(promptText).toContain("[User Confirmed]");
  });

  it("allows Deep Plan Builder to write .liteagent plan artifacts without owning execution", () => {
    const promptText = readPrompt("deep-plan-builder");

    expect(promptText).toContain("Match the user's language");
    expect(promptText).toContain("Keep code identifiers, file paths, commands, and schema keys unchanged");
    expect(promptText).toContain("recommended_plan_path");
    expect(promptText).toContain(".liteagent/plans/");
    expect(promptText).toContain("write and maintain the final detailed plan artifact yourself");
    expect(promptText).toContain(".liteagent/plan-index.jsonl");
    expect(config.agent["deep-plan-builder"]?.permission?.edit).toMatchObject({
      ".liteagent/**": "allow",
    });
    expect(promptText).toContain("Direct plan persistence does not grant execution dispatch, final approval, or canonical state advancement authority");
    expect(promptText).toContain("## Decision Selector Discipline");
    expect(promptText).toContain("Question tool");
    expect(promptText).toContain("migration strategy");
    expect(promptText).toContain("Custom / other");
    expect(promptText).toContain("[User Confirmed]");
  });

  it("requires Task Lead and reviewers to request scoped evidence when needed", () => {
    expect(readPrompt("task-lead")).toContain("require scoped Explore evidence");
    expect(readPrompt("task-lead")).toContain("required Explore evidence is missing");
    expect(readPrompt("plan-review")).toContain("actively request scoped Explore evidence");
    expect(readPrompt("plan-review")).toContain("without locatable evidence");
    expect(readPrompt("result-review")).toContain("actively request scoped Explore evidence");
  });

  it("keeps the full assignment contract centralized in Command Lead", () => {
    const promptText = readPrompt("command-lead");
    const requiredFieldNames = [
      "TASK",
      "EXPECTED OUTCOME",
      "ROLE",
      "SCOPE",
      "UPSTREAM EVIDENCE",
      "REQUIRED TOOLS",
      "MUST DO",
      "MUST NOT DO",
      "CONTEXT",
      "DELIVERABLE FORMAT",
      "FAILURE RETURN",
    ];

    for (const field of requiredFieldNames) {
      expect(promptText, field).toContain(field);
    }
  });

  it("requires delegating roles to reference the Command Lead assignment contract", () => {
    const delegatingRoles = [
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "plan-review",
      "result-review",
    ];

    for (const roleName of delegatingRoles) {
      const promptText = readPrompt(roleName);
      expect(promptText, roleName).toContain("Command Lead assignment contract");
      expect(promptText, roleName).toContain("TASK");
      expect(promptText, roleName).toContain("EXPECTED OUTCOME");
      expect(promptText, roleName).toContain("ROLE");
      expect(promptText, roleName).toContain("SCOPE");
      expect(promptText, roleName).toContain("FAILURE RETURN");
    }
  });
});

function readPrompt(roleName: string): string {
  const prompt = config.agent[roleName]?.prompt;
  const filePath = prompt?.match(/^\{file:(.*)\}$/)?.[1];

  if (!filePath) {
    throw new Error(`Missing prompt file for ${roleName}`);
  }

  return readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function nextVisibleAgent(tabCycle: string[], current: string): string | undefined {
  const index = tabCycle.indexOf(current);
  if (index === -1) return undefined;

  return tabCycle[(index + 1) % tabCycle.length];
}
