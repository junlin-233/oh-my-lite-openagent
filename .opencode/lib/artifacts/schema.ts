import type {
  CanonicalState,
  ReviewDecision,
  ReviewRoleName,
  ReviewSeverity,
  ReviewSurface,
  RoleName,
} from "../contracts.js";

export const ARTIFACT_KINDS = [
  "plan-skeleton",
  "detailed-plan",
  "approval-state",
  "execution-summary",
  "child-task-return-summary",
  "review-result",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type OwnedArtifactKind = Exclude<ArtifactKind, "review-result">;
export type PlanReviewArtifactKind = "plan-skeleton" | "detailed-plan";
export type ResultReviewArtifactKind = "execution-summary";

export interface ReviewFinding {
  location: string;
  issue: string;
  passCriteria: string;
}

export interface ArtifactRecord<TPayload = unknown> {
  id: string;
  kind: ArtifactKind;
  owner: RoleName;
  state: CanonicalState;
  payload: TPayload;
}

export interface ReviewResultPayload {
  subjectArtifactId: string;
  subjectArtifactKind: ArtifactKind;
  surface: ReviewSurface;
  decision: ReviewDecision;
  severity?: ReviewSeverity;
  rejectionCount: number;
  majorRejectionCount: number;
  gateVisible: true;
  reviewer: ReviewRoleName;
  findings: ReviewFinding[];
}

export type ReviewResultArtifact = ArtifactRecord<ReviewResultPayload>;

export const ARTIFACT_OWNERSHIP: Readonly<Record<OwnedArtifactKind, RoleName>> = {
  "plan-skeleton": "plan-builder",
  "detailed-plan": "deep-plan-builder",
  "approval-state": "command-lead",
  "execution-summary": "command-lead",
  "child-task-return-summary": "task-lead",
};

export const APPROVAL_GATE_ARTIFACTS: readonly ArtifactKind[] = [
  "plan-skeleton",
  "detailed-plan",
  "execution-summary",
];

export function createArtifactRecord<TPayload>(input: {
  id: string;
  kind: OwnedArtifactKind;
  state: CanonicalState;
  payload: TPayload;
}): ArtifactRecord<TPayload> {
  return {
    id: input.id,
    kind: input.kind,
    owner: ARTIFACT_OWNERSHIP[input.kind],
    state: input.state,
    payload: input.payload,
  };
}

export function createReviewResultArtifact(input: {
  id: string;
  subjectArtifact: Pick<ArtifactRecord<unknown>, "id" | "kind">;
  reviewer: ReviewRoleName;
  surface: ReviewSurface;
  decision: ReviewDecision;
  severity?: ReviewSeverity;
  rejectionCount: number;
  majorRejectionCount: number;
  findings?: ReviewFinding[];
}): ReviewResultArtifact {
  const payload: ReviewResultPayload = {
    subjectArtifactId: input.subjectArtifact.id,
    subjectArtifactKind: input.subjectArtifact.kind,
    surface: input.surface,
    decision: input.decision,
    ...(input.severity ? { severity: input.severity } : {}),
    rejectionCount: input.rejectionCount,
    majorRejectionCount: input.majorRejectionCount,
    gateVisible: true,
    reviewer: input.reviewer,
    findings: input.findings ?? [],
  };

  return {
    id: input.id,
    kind: "review-result",
    owner: input.reviewer,
    state: "reviewed",
    payload,
  };
}
