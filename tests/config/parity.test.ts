import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  PLANNER_CONTRACTS,
  ROLE_CONTRACTS,
  ROUTING_CATEGORIES,
  VISIBLE_MODES,
} from "../../.opencode/lib/contracts.js";
import { CATEGORY_ROUTES } from "../../.opencode/lib/runtime/categories.js";
import {
  ROLE_MODEL_PROFILES as RUNTIME_ROLE_MODEL_PROFILES,
  type RoleModelProfile,
} from "../../.opencode/lib/runtime/role-model-recommendations.js";

const managedConfigModule = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/managed-config.mjs")).href
);
const config = managedConfigModule.MANAGED_CONFIG as {
  agent: Record<string, { mode: string; hidden?: boolean }>;
};
const installScript = readFileSync(path.resolve(process.cwd(), "scripts/install.mjs"), "utf8");

describe("config and runtime parity", () => {
  it("keeps managed agent registration aligned with role contracts", () => {
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
    expect(PLANNER_CONTRACTS["deep-plan-builder"].targetExecutorProfile).toBe(
      "lower-strength-compatible",
    );
  });

  it("keeps installer and runtime role model recommendation priority aligned", () => {
    const roleModelProfileBlock = installScript.match(
      /export const ROLE_MODEL_PROFILES = \[([\s\S]*?)\n\];/,
    )?.[1];
    expect(roleModelProfileBlock).toBeTruthy();
    if (!roleModelProfileBlock) throw new Error("Missing installer ROLE_MODEL_PROFILES block");

    const runtimePatterns = Object.fromEntries(
      (RUNTIME_ROLE_MODEL_PROFILES as readonly RoleModelProfile[]).map((profile) => [
        profile.role,
        profile.recommendations.map((recommendation) => recommendation.pattern),
      ]),
    );
    const installerPatterns: Record<string, string[]> = {};
    for (const match of roleModelProfileBlock.matchAll(
      /role: "([^"]+)"[\s\S]*?recommendations: \[([\s\S]*?)\]/g,
    )) {
      const roleName = match[1];
      const recommendationsBlock = match[2];
      if (!roleName || !recommendationsBlock) continue;
      installerPatterns[roleName] = Array.from(
        recommendationsBlock.matchAll(/"([^"]+)"/g),
        (item) => item[1] ?? "",
      ).filter(Boolean);
    }

    expect(installerPatterns).toEqual(runtimePatterns);
  });

  it("keeps review verdict output schemas aligned", () => {
    const extractMarkedBlock = (agentFile: string) => {
      const prompt = readFileSync(path.resolve(process.cwd(), ".opencode/agents", agentFile), "utf8");
      const match = prompt.match(
        /<!-- REVIEW_OUTPUT_SCHEMA_START -->([\s\S]*?)<!-- REVIEW_OUTPUT_SCHEMA_END -->/,
      );
      expect(match, agentFile).not.toBeNull();
      if (!match) throw new Error(`Missing review output schema markers in ${agentFile}`);
      const schemaBlock = match[1];
      if (!schemaBlock) throw new Error(`Missing review output schema block in ${agentFile}`);
      return schemaBlock.trim();
    };

    expect(extractMarkedBlock("result-review.md")).toBe(extractMarkedBlock("plan-review.md"));
  });
});
