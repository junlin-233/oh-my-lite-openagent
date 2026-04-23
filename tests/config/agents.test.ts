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
    expect(config.command?.["Character-model"]).toMatchObject({
      agent: "command-lead",
    });
    expect(config.command?.["Character-model"]?.template).toContain("bounded_lite_model_config");
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
