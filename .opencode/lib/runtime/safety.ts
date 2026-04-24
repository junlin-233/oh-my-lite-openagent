import {
  CANONICAL_STATES,
  MAX_CHILD_ORCHESTRATOR_DEPTH,
  PLANNER_CONTRACTS,
  ROLE_CONTRACTS,
  ROUTING_CATEGORIES,
  VISIBLE_MODES,
  type RoleName,
} from "../contracts.js";

export interface RuntimeProfile {
  mode: "full" | "degraded";
  hooksEnabled: boolean;
  backgroundEnabled: boolean;
  bundledMcpEnabled: boolean;
  visibleModes: readonly string[];
  roleNames: readonly RoleName[];
  canonicalStates: readonly string[];
}

export interface ArchitectureFinding {
  name: string;
  passed: boolean;
  detail: string;
}

export function createRuntimeProfile(input: {
  pluginEnabled: boolean;
  hooksEnabled: boolean;
  backgroundEnabled: boolean;
  bundledMcpEnabled: boolean;
}): RuntimeProfile {
  return {
    mode:
      input.pluginEnabled && input.hooksEnabled && input.backgroundEnabled ? "full" : "degraded",
    hooksEnabled: input.pluginEnabled && input.hooksEnabled,
    backgroundEnabled: input.pluginEnabled && input.backgroundEnabled,
    bundledMcpEnabled: input.pluginEnabled && input.bundledMcpEnabled,
    visibleModes: VISIBLE_MODES,
    roleNames: ROLE_CONTRACTS.map((role) => role.name),
    canonicalStates: CANONICAL_STATES,
  };
}

export function validateOrchestratorDepth(depth: number): boolean {
  return depth <= MAX_CHILD_ORCHESTRATOR_DEPTH;
}

export function validateArchitectureContracts(): ArchitectureFinding[] {
  const visibleRoles = ROLE_CONTRACTS.filter((role) => role.visibility === "visible");
  const hiddenRoles = ROLE_CONTRACTS.filter((role) => role.visibility === "internal-only");

  return [
    {
      name: "visible-mode-count",
      passed: visibleRoles.length === 3 && VISIBLE_MODES.length === 3,
      detail: `Found ${visibleRoles.length} visible roles and ${VISIBLE_MODES.length} visible modes.`,
    },
    {
      name: "fixed-role-count",
      passed: ROLE_CONTRACTS.length === 8,
      detail: `Found ${ROLE_CONTRACTS.length} fixed roles.`,
    },
    {
      name: "internal-roles-hidden",
      passed: hiddenRoles.every((role) => role.hidden),
      detail: `All ${hiddenRoles.length} internal-only roles remain hidden.`,
    },
    {
      name: "canonical-state-count",
      passed: CANONICAL_STATES.length === 5,
      detail: `Found ${CANONICAL_STATES.length} canonical states.`,
    },
    {
      name: "category-set-stable",
      passed: ROUTING_CATEGORIES.length === 7,
      detail: `Found ${ROUTING_CATEGORIES.length} routing categories.`,
    },
    {
      name: "planner-dual-mode-contract",
      passed:
        PLANNER_CONTRACTS["plan-builder"].supportedInvocations.includes("discussion") &&
        PLANNER_CONTRACTS["plan-builder"].supportedInvocations.includes("normalize") &&
        PLANNER_CONTRACTS["plan-builder"].internalOnlyInvocations.includes("normalize") &&
        PLANNER_CONTRACTS["plan-builder"].planReview === "optional" &&
        PLANNER_CONTRACTS["deep-plan-builder"].planReview === "required" &&
        PLANNER_CONTRACTS["deep-plan-builder"].targetExecutorProfile === "lower-strength-compatible",
      detail: "Plan Builder keeps optional review while Deep Plan Builder requires plan review for detailed lower-strength-executor handoff.",
    },
    {
      name: "max-orchestrator-depth",
      passed: validateOrchestratorDepth(MAX_CHILD_ORCHESTRATOR_DEPTH),
      detail: `Maximum child orchestrator depth is ${MAX_CHILD_ORCHESTRATOR_DEPTH}.`,
    },
  ];
}
