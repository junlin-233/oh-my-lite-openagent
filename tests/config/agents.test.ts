import { readFileSync } from "node:fs";
import path from "node:path";

const configPath = path.resolve(process.cwd(), "opencode.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  default_agent?: string;
  command?: Record<string, { agent?: string; template?: string; description?: string }>;
  agent: Record<
    string,
    { mode: string; hidden?: boolean; description?: string; color?: string; prompt?: string }
  >;
};

describe("OpenCode agent topology", () => {
  it("starts OpenCode in the bounded command lead by default", () => {
    expect(config.default_agent).toBe("command-lead");
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
    expect(promptText).toContain("Do not perform whole-repo unbounded search");
    expect(promptText).toContain("Result Review");
    expect(promptText).toContain("never a Task Lead child return");
    expect(promptText).not.toContain("OMO_INTERNAL_INITIATOR");
  });

  it("keeps Command Lead routing thresholds explicit", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Routing Thresholds");
    expect(promptText).toContain("Execute directly when all of these are true");
    expect(promptText).toContain("Route to Plan Builder when any of these are true");
    expect(promptText).toContain("Route to Deep Plan Builder when any of these are true");
    expect(promptText).toContain("lower-strength model");
    expect(promptText).toContain("detailed plan artifact");
    expect(promptText).toContain("architecture invariants");
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
    expect(promptText).toContain("route to Deep Plan Builder for a detailed plan");
    expect(promptText).toContain("escalate with the blockers");
  });

  it("requires Command Lead to persist plan artifacts under .liteagent", () => {
    const promptText = readPrompt("command-lead");

    expect(promptText).toContain("## Plan Artifact Persistence");
    expect(promptText).toContain(".liteagent/plans/");
    expect(promptText).toContain(".liteagent/plan-index.jsonl");
    expect(promptText).toContain("bounded_lite_plan_artifact");
    expect(promptText).toContain("Do not write plan artifacts under `.opencode/`");
  });

  it("keeps Plan Builder aligned with the v2.1 plan spec", () => {
    const promptText = readPrompt("plan-builder");

    expect(promptText).toContain("## Spec v2.1 Compliance");
    expect(promptText).toContain("plan_schema_version: 2.1");
    expect(promptText).toContain("maturity_level: M0|M1|M2|M3");
    expect(promptText).toContain("[User Confirmed]");
    expect(promptText).toContain("[Repo Observed]");
    expect(promptText).toContain("[Inferred]");
    expect(promptText).toContain("[Open Question]");
    expect(promptText).toContain("basis");
    expect(promptText).toContain("failure_if_false");
    expect(promptText).toContain("Not Applicable");
    expect(promptText).toContain("Deferred");
    expect(promptText).toContain("Unknown Yet");
    expect(promptText).toContain("5 turns");
    expect(promptText).toContain("current-state conflicts");
    expect(promptText).toContain("target-state gaps");
    expect(promptText).toContain("never `reviewed` or `M3`");
    expect(promptText).toContain("recommended_plan_path");
    expect(promptText).toContain(".liteagent/plans/");
  });

  it("requires Deep Plan Builder to return a .liteagent plan path without owning persistence", () => {
    const promptText = readPrompt("deep-plan-builder");

    expect(promptText).toContain("recommended_plan_path");
    expect(promptText).toContain(".liteagent/plans/");
    expect(promptText).toContain("Command Lead owns actual file persistence");
  });

  it("requires every delegating role to use the standard assignment fields", () => {
    const delegatingRoles = [
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "plan-review",
      "result-review",
    ];
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

    for (const roleName of delegatingRoles) {
      const promptText = readPrompt(roleName);
      for (const field of requiredFieldNames) {
        expect(promptText, `${roleName}:${field}`).toContain(field);
      }
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
