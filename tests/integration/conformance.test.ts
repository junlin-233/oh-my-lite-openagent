import {
  MAX_CHILD_ORCHESTRATOR_DEPTH,
  PLANNER_CONTRACTS,
  ROUTING_CATEGORIES,
} from "../../.opencode/lib/contracts.js";
import {
  createRuntimeProfile,
  validateArchitectureContracts,
  validateOrchestratorDepth,
} from "../../.opencode/lib/runtime/safety.js";

describe("architecture conformance", () => {
  it("keeps the declared architecture invariants passing", () => {
    const findings = validateArchitectureContracts();
    expect(findings.every((finding) => finding.passed)).toBe(true);
  });

  it("keeps child orchestrator depth bounded at one", () => {
    expect(MAX_CHILD_ORCHESTRATOR_DEPTH).toBe(1);
    expect(validateOrchestratorDepth(1)).toBe(true);
    expect(validateOrchestratorDepth(2)).toBe(false);
  });

  it("keeps routing categories small, stable, and mapped back to one runtime profile", () => {
    const profile = createRuntimeProfile({
      pluginEnabled: true,
      hooksEnabled: true,
      backgroundEnabled: true,
      bundledMcpEnabled: false,
    });

    expect(ROUTING_CATEGORIES).toEqual([
      "execution",
      "planning",
      "deep-planning",
      "explore",
      "librarian",
      "review",
    ]);
    expect(profile.mode).toBe("full");
    expect(profile.visibleModes).toHaveLength(3);
  });

  it("keeps planner invocation semantics explicit without adding extra planner layers", () => {
    expect(PLANNER_CONTRACTS["plan-builder"]).toEqual({
      name: "plan-builder",
      supportedInvocations: ["discussion", "normalize"],
      internalOnlyInvocations: ["normalize"],
      requiresStableSkeleton: false,
      outputArtifactKind: "plan-skeleton",
    });
    expect(PLANNER_CONTRACTS["power-plan-builder"]).toEqual({
      name: "power-plan-builder",
      supportedInvocations: ["deepen"],
      internalOnlyInvocations: [],
      requiresStableSkeleton: true,
      outputArtifactKind: "detailed-plan",
    });
    expect(ROUTING_CATEGORIES).not.toContain("normalize");
    expect(ROUTING_CATEGORIES).not.toContain("discussion");
  });
});
