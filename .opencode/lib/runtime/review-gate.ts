import type { ReviewDecision, RoleName } from "../contracts.js";
import { transitionArtifact } from "../artifacts/state-machine.js";
import {
  APPROVAL_GATE_ARTIFACTS,
  createReviewResultArtifact,
  type ArtifactRecord,
  type ReviewResultArtifact,
} from "../artifacts/schema.js";

export interface AppliedReviewCycle<TPayload> {
  artifact: ArtifactRecord<TPayload>;
  reviewResult: ReviewResultArtifact;
}

export function requiresApprovalGate(kind: ArtifactRecord["kind"]): boolean {
  return APPROVAL_GATE_ARTIFACTS.includes(kind);
}

export function submitForApproval<TPayload>(artifact: ArtifactRecord<TPayload>, actor: RoleName) {
  if (!requiresApprovalGate(artifact.kind)) {
    throw new Error(`Artifact kind ${artifact.kind} does not require an explicit approval gate.`);
  }

  return transitionArtifact({
    artifact,
    nextState: "needs-approval",
    actor,
  });
}

export function approveArtifact<TPayload>(artifact: ArtifactRecord<TPayload>, actor: RoleName) {
  return transitionArtifact({
    artifact,
    nextState: "approved",
    actor,
  });
}

export function beginExecution<TPayload>(artifact: ArtifactRecord<TPayload>, actor: RoleName) {
  return transitionArtifact({
    artifact,
    nextState: "executing",
    actor,
  });
}

export function recordReviewResult<TPayload>(input: {
  reviewResultId: string;
  artifact: ArtifactRecord<TPayload>;
  reviewer: RoleName;
  decision: ReviewDecision;
  previousReviewResult?: ReviewResultArtifact;
}): ReviewResultArtifact {
  if (input.reviewer !== "review") {
    throw new Error("Only review may produce a review-result artifact.");
  }

  if (input.artifact.state !== "executing") {
    throw new Error("Review results may only be recorded for executing artifacts.");
  }

  const previousRejectionCount = input.previousReviewResult?.payload.rejectionCount ?? 0;
  const nextRejectionCount = input.decision === "pass" ? 0 : previousRejectionCount + 1;

  let effectiveDecision: ReviewDecision = input.decision;

  if (input.decision === "reject" && nextRejectionCount >= 2) {
    effectiveDecision = "escalate";
  }

  return createReviewResultArtifact({
    id: input.reviewResultId,
    subjectArtifact: input.artifact,
    decision: effectiveDecision,
    rejectionCount: nextRejectionCount,
  });
}

export function applyReviewResult<TPayload>(input: {
  artifact: ArtifactRecord<TPayload>;
  reviewResult: ReviewResultArtifact;
  actor: RoleName;
}): AppliedReviewCycle<TPayload> {
  if (input.reviewResult.payload.subjectArtifactId !== input.artifact.id) {
    throw new Error("Review result does not belong to the provided artifact.");
  }

  const reviewedArtifact = transitionArtifact({
    artifact: input.artifact,
    nextState: "reviewed",
    actor: input.actor,
  });

  if (input.reviewResult.payload.decision === "pass") {
    return {
      artifact: transitionArtifact({
        artifact: reviewedArtifact,
        nextState: "approved",
        actor: input.actor,
      }),
      reviewResult: input.reviewResult,
    };
  }

  if (input.reviewResult.payload.decision === "escalate") {
    return {
      artifact: transitionArtifact({
        artifact: reviewedArtifact,
        nextState: "needs-approval",
        actor: input.actor,
      }),
      reviewResult: input.reviewResult,
    };
  }

  return {
    artifact: transitionArtifact({
      artifact: reviewedArtifact,
      nextState: "draft",
      actor: input.actor,
    }),
    reviewResult: input.reviewResult,
  };
}
