import {
  MAX_REVIEW_REVISION_ITERATIONS,
  REVIEW_ROLE_BY_SURFACE,
  type ReviewDecision,
  type ReviewRoleName,
  type ReviewSeverity,
  type ReviewSurface,
  type RoleName,
} from "../contracts.js";
import { transitionArtifact } from "../artifacts/state-machine.js";
import {
  APPROVAL_GATE_ARTIFACTS,
  createReviewResultArtifact,
  type ArtifactRecord,
  type ArtifactKind,
  type ReviewFinding,
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

export function reviewSurfaceForArtifact(kind: ArtifactKind): ReviewSurface | undefined {
  if (kind === "plan-skeleton" || kind === "detailed-plan") return "plan";
  if (kind === "execution-summary") return "result";

  return undefined;
}

export function reviewerForArtifact(kind: ArtifactKind): ReviewRoleName | undefined {
  const surface = reviewSurfaceForArtifact(kind);
  return surface ? REVIEW_ROLE_BY_SURFACE[surface] : undefined;
}

export function recordReviewResult<TPayload>(input: {
  reviewResultId: string;
  artifact: ArtifactRecord<TPayload>;
  reviewer: RoleName;
  decision: ReviewDecision;
  severity?: ReviewSeverity;
  findings?: ReviewFinding[];
  previousReviewResult?: ReviewResultArtifact;
}): ReviewResultArtifact {
  const surface = reviewSurfaceForArtifact(input.artifact.kind);
  const expectedReviewer = reviewerForArtifact(input.artifact.kind);

  if (!surface || !expectedReviewer) {
    throw new Error(`Artifact kind ${input.artifact.kind} is not reviewable.`);
  }

  if (input.reviewer !== expectedReviewer) {
    throw new Error(`Only ${expectedReviewer} may review ${input.artifact.kind} artifacts.`);
  }

  if (input.artifact.state !== "executing") {
    throw new Error("Review results may only be recorded for executing artifacts.");
  }

  if (input.decision === "reject" && !input.severity) {
    throw new Error("Rejected review results must include minor or major severity.");
  }

  if (input.decision === "pass" && input.severity) {
    throw new Error("Passing review results must not include severity.");
  }

  if (
    input.previousReviewResult &&
    input.previousReviewResult.payload.surface !== surface
  ) {
    throw new Error("Previous review result belongs to a different review surface.");
  }

  const previousRejectionCount = input.previousReviewResult?.payload.rejectionCount ?? 0;
  const previousMajorRejectionCount = input.previousReviewResult?.payload.majorRejectionCount ?? 0;
  const nextRejectionCount = input.decision === "pass" ? 0 : previousRejectionCount + 1;
  const nextMajorRejectionCount =
    input.decision === "reject" && input.severity === "major"
      ? previousMajorRejectionCount + 1
      : previousMajorRejectionCount;

  let effectiveDecision: ReviewDecision = input.decision;

  if (
    input.decision === "reject" &&
    input.severity === "major" &&
    nextMajorRejectionCount > MAX_REVIEW_REVISION_ITERATIONS
  ) {
    effectiveDecision = "escalate";
  }

  return createReviewResultArtifact({
    id: input.reviewResultId,
    subjectArtifact: input.artifact,
    reviewer: expectedReviewer,
    surface,
    decision: effectiveDecision,
    ...(input.severity ? { severity: input.severity } : {}),
    rejectionCount: nextRejectionCount,
    majorRejectionCount: nextMajorRejectionCount,
    ...(input.findings ? { findings: input.findings } : {}),
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
