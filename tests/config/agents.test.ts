import { readFileSync } from "node:fs";
import path from "node:path";

const configPath = path.resolve(process.cwd(), "opencode.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  default_agent?: string;
  agent: Record<string, { mode: string; hidden?: boolean; description?: string }>;
};

describe("OpenCode agent topology", () => {
  it("starts OpenCode in the bounded command lead by default", () => {
    expect(config.default_agent).toBe("command-lead");
  });

  it("registers seven bounded roles plus disabled built-in overrides", () => {
    expect(Object.keys(config.agent)).toHaveLength(9);
    expect(config.agent.build).toMatchObject({ mode: "subagent", hidden: true });
    expect(config.agent.plan).toMatchObject({ mode: "subagent", hidden: true });
  });

  it("exposes exactly three visible user-facing modes", () => {
    const visibleAgents = Object.entries(config.agent)
      .filter(([, agent]) => !agent.hidden && agent.mode !== "subagent")
      .map(([name]) => name)
      .sort();

    expect(visibleAgents).toEqual([
      "command-lead",
      "plan-builder",
      "power-plan-builder",
    ]);
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
      "review",
      "task-lead",
    ]);
  });

  it("keeps planners dual-use without adding extra visible modes", () => {
    expect(config.agent["plan-builder"]?.mode).toBe("all");
    expect(config.agent["power-plan-builder"]?.mode).toBe("all");
    expect(config.agent["plan-builder"]?.description).toContain("discussion mode");
    expect(config.agent["plan-builder"]?.description).toContain("normalize mode");
    expect(config.agent["power-plan-builder"]?.description).toContain("stable skeleton");
  });
});
