export const VISIBLE_MODES = ["execution", "planning", "deep-planning"] as const;

export const ROUTING_CATEGORIES = [
  "execution",
  "planning",
  "deep-planning",
  "explore",
  "librarian",
  "review",
] as const;

export const CANONICAL_STATES = [
  "draft",
  "needs-approval",
  "approved",
  "executing",
  "reviewed",
] as const;

export const REVIEW_DECISIONS = ["pass", "reject", "escalate"] as const;

export const MAX_CHILD_ORCHESTRATOR_DEPTH = 1;

export type VisibleMode = (typeof VISIBLE_MODES)[number];
export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];
export type CanonicalState = (typeof CANONICAL_STATES)[number];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type RoleName =
  | "command-lead"
  | "plan-builder"
  | "power-plan-builder"
  | "task-lead"
  | "explore"
  | "librarian"
  | "review";

export type RoleVisibility = "visible" | "internal-only";
export type OpencodeMode = "primary" | "subagent" | "all";
export type PlannerRoleName = "plan-builder" | "power-plan-builder";
export type PlannerInvocation = "discussion" | "normalize" | "deepen";

export interface RoleContract {
  name: RoleName;
  visibleMode?: VisibleMode;
  visibility: RoleVisibility;
  opencodeMode: OpencodeMode;
  hidden: boolean;
  mayDelegateTo: readonly RoleName[];
}

export interface PlannerContract {
  name: PlannerRoleName;
  supportedInvocations: readonly PlannerInvocation[];
  internalOnlyInvocations: readonly PlannerInvocation[];
  requiresStableSkeleton: boolean;
  outputArtifactKind: "plan-skeleton" | "detailed-plan";
}

export const ROLE_CONTRACTS: readonly RoleContract[] = [
  {
    name: "command-lead",
    visibleMode: "execution",
    visibility: "visible",
    opencodeMode: "primary",
    hidden: false,
    mayDelegateTo: [
      "plan-builder",
      "power-plan-builder",
      "task-lead",
      "explore",
      "librarian",
      "review",
    ],
  },
  {
    name: "plan-builder",
    visibleMode: "planning",
    visibility: "visible",
    opencodeMode: "all",
    hidden: false,
    mayDelegateTo: ["explore", "librarian", "review"],
  },
  {
    name: "power-plan-builder",
    visibleMode: "deep-planning",
    visibility: "visible",
    opencodeMode: "all",
    hidden: false,
    mayDelegateTo: ["explore", "librarian", "review"],
  },
  {
    name: "task-lead",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: ["explore", "librarian", "review"],
  },
  {
    name: "explore",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: [],
  },
  {
    name: "librarian",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: [],
  },
  {
    name: "review",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: [],
  },
] as const;

export const PLANNER_CONTRACTS: Readonly<Record<PlannerRoleName, PlannerContract>> = {
  "plan-builder": {
    name: "plan-builder",
    supportedInvocations: ["discussion", "normalize"],
    internalOnlyInvocations: ["normalize"],
    requiresStableSkeleton: false,
    outputArtifactKind: "plan-skeleton",
  },
  "power-plan-builder": {
    name: "power-plan-builder",
    supportedInvocations: ["deepen"],
    internalOnlyInvocations: [],
    requiresStableSkeleton: true,
    outputArtifactKind: "detailed-plan",
  },
};

export function getRoleContract(roleName: RoleName): RoleContract {
  const contract = ROLE_CONTRACTS.find((item) => item.name === roleName);

  if (!contract) {
    throw new Error(`Unknown role contract: ${roleName}`);
  }

  return contract;
}

export function getPlannerContract(roleName: PlannerRoleName): PlannerContract {
  return PLANNER_CONTRACTS[roleName];
}
