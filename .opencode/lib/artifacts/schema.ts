import type { CanonicalState, ReviewDecision, RoleName } from "../contracts.js";

export const ARTIFACT_KINDS = [
  "plan-skeleton",
  "detailed-plan",
  "approval-state",
  "execution-summary",
  "child-task-return-summary",
  "review-result",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

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
  decision: ReviewDecision;
  rejectionCount: number;
  gateVisible: true;
  reviewer: "review";
}

export type ReviewResultArtifact = ArtifactRecord<ReviewResultPayload>;

export const ARTIFACT_OWNERSHIP: Readonly<Record<ArtifactKind, RoleName>> = {
  "plan-skeleton": "plan-builder",
  "detailed-plan": "power-plan-builder",
  "approval-state": "command-lead",
  "execution-summary": "command-lead",
  "child-task-return-summary": "task-lead",
  "review-result": "review",
};

export const APPROVAL_GATE_ARTIFACTS: readonly ArtifactKind[] = [
  "plan-skeleton",
  "detailed-plan",
  "execution-summary",
];

export function createArtifactRecord<TPayload>(input: {
  id: string;
  kind: ArtifactKind;
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
  decision: ReviewDecision;
  rejectionCount: number;
}): ReviewResultArtifact {
  return createArtifactRecord({
    id: input.id,
    kind: "review-result",
    state: "reviewed",
    payload: {
      subjectArtifactId: input.subjectArtifact.id,
      subjectArtifactKind: input.subjectArtifact.kind,
      decision: input.decision,
      rejectionCount: input.rejectionCount,
      gateVisible: true,
      reviewer: "review",
    },
  });
}
