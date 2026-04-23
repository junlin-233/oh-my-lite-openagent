import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PLANNER_CONTRACTS,
  ROLE_CONTRACTS,
  ROUTING_CATEGORIES,
  VISIBLE_MODES,
} from "../../.opencode/lib/contracts.js";
import { CATEGORY_ROUTES } from "../../.opencode/lib/runtime/categories.js";

const configPath = path.resolve(process.cwd(), "opencode.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
  agent: Record<string, { mode: string; hidden?: boolean }>;
};

describe("config and runtime parity", () => {
  it("keeps opencode.json agent registration aligned with role contracts", () => {
    const contractRoleNames = ROLE_CONTRACTS.map((role) => role.name).sort();
    const configuredRoleNames = Object.keys(config.agent)
      .filter((name) => name !== "build" && name !== "plan")
      .sort();

    expect(configuredRoleNames).toEqual(contractRoleNames);

    for (const role of ROLE_CONTRACTS) {
      const agent = config.agent[role.name];
      expect(agent?.mode).toBe(role.opencodeMode);
      expect(Boolean(agent?.hidden)).toBe(role.hidden);
    }
  });

  it("hides OpenCode built-in build and plan modes behind disabled overrides", () => {
    expect(config.agent.build).toMatchObject({ mode: "subagent", hidden: true });
    expect(config.agent.plan).toMatchObject({ mode: "subagent", hidden: true });
  });

  it("keeps routing categories and visible modes synchronized", () => {
    expect(Object.keys(CATEGORY_ROUTES).sort()).toEqual([...ROUTING_CATEGORIES].sort());

    const visibleRouteModes = Object.values(CATEGORY_ROUTES)
      .flatMap((route) => (route.visibleMode ? [route.visibleMode] : []))
      .sort();

    expect(visibleRouteModes).toEqual([...VISIBLE_MODES].sort());
  });

  it("keeps planner contracts aligned with the configured dual-use planners", () => {
    expect(config.agent["plan-builder"]?.mode).toBe("all");
    expect(config.agent["deep-plan-builder"]?.mode).toBe("all");
    expect(PLANNER_CONTRACTS["plan-builder"].internalOnlyInvocations).toEqual(["normalize"]);
    expect(PLANNER_CONTRACTS["plan-builder"].planReview).toBe("optional");
    expect(PLANNER_CONTRACTS["deep-plan-builder"].planReview).toBe("required");
    expect(PLANNER_CONTRACTS["deep-plan-builder"].modelStrength).toBe("weak");
  });
});
