import { readFileSync } from "node:fs";
import path from "node:path";

const configPath = path.resolve(process.cwd(), "opencode.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  agent: Record<
    string,
    { permission?: Record<string, string | Record<string, string>> }
  >;
};

function taskRules(agentName: string): Record<string, string> {
  const task = config.agent[agentName]?.permission?.task;
  return typeof task === "object" && task !== null ? task : {};
}

describe("delegation boundaries", () => {
  it("lets Command Lead delegate across the full registered role skeleton", () => {
    expect(taskRules("command-lead")).toEqual({
      "*": "deny",
      "plan-builder": "allow",
      "deep-plan-builder": "allow",
      "task-lead": "allow",
      explore: "allow",
      librarian: "allow",
      "plan-review": "allow",
      "result-review": "allow",
    });
  });

  it("keeps planners within shared capability delegation only", () => {
    const expected = {
      "*": "deny",
      explore: "allow",
      librarian: "allow",
      "plan-review": "allow",
    };

    expect(taskRules("plan-builder")).toEqual(expected);
    expect(taskRules("deep-plan-builder")).toEqual(expected);
  });

  it("keeps Task Lead bounded and review specialists read-only", () => {
    expect(taskRules("task-lead")).toEqual({
      "*": "deny",
      explore: "allow",
      librarian: "allow",
    });

    expect(taskRules("explore")).toEqual({ "*": "deny" });
    expect(taskRules("librarian")).toEqual({ "*": "deny" });
    expect(taskRules("plan-review")).toEqual({ "*": "deny", explore: "allow" });
    expect(taskRules("result-review")).toEqual({ "*": "deny", explore: "allow" });
  });

  it("denies delegation through disabled OpenCode built-in modes", () => {
    expect(taskRules("build")).toEqual({ "*": "deny" });
    expect(taskRules("plan")).toEqual({ "*": "deny" });
    expect(config.agent.build?.permission?.["*"]).toBe("deny");
    expect(config.agent.plan?.permission?.["*"]).toBe("deny");
  });

  it("puts task deny catch-alls before specific allows because OpenCode uses last match wins", () => {
    for (const [agentName, rules] of Object.entries(config.agent)) {
      const task = rules.permission?.task;
      if (typeof task !== "object" || task === null) continue;

      expect(Object.keys(task)[0], agentName).toBe("*");
    }
  });

  it("uses scalar web permissions accepted by OpenCode config validation", () => {
    expect(config.agent.explore?.permission?.webfetch).toBe("deny");
    expect(config.agent.explore?.permission?.websearch).toBe("deny");
    expect(config.agent.librarian?.permission?.webfetch).toBe("allow");
    expect(config.agent.librarian?.permission?.websearch).toBe("allow");
  });
});
