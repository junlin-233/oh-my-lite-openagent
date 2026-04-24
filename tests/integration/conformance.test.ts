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
      "plan-review",
      "result-review",
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
      plannerModelProfile: "strong",
      targetExecutorProfile: "strong",
      planReview: "optional",
    });
    expect(PLANNER_CONTRACTS["deep-plan-builder"]).toEqual({
      name: "deep-plan-builder",
      supportedInvocations: ["discussion", "deep-plan"],
      internalOnlyInvocations: [],
      requiresStableSkeleton: false,
      outputArtifactKind: "detailed-plan",
      plannerModelProfile: "review-compensated",
      targetExecutorProfile: "lower-strength-compatible",
      planReview: "required",
    });
    expect(ROUTING_CATEGORIES).not.toContain("normalize");
    expect(ROUTING_CATEGORIES).not.toContain("discussion");
  });
});
