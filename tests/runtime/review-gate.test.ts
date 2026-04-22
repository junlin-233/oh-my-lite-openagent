import { createArtifactRecord } from "../../.opencode/lib/artifacts/schema.js";
import {
  applyReviewResult,
  approveArtifact,
  beginExecution,
  recordReviewResult,
  submitForApproval,
} from "../../.opencode/lib/runtime/review-gate.js";

describe("review gate behavior", () => {
  it("requires an explicit visible approval gate for reviewable artifacts", () => {
    const artifact = createArtifactRecord({
      id: "plan-1",
      kind: "plan-skeleton",
      state: "draft",
      payload: { summary: "stable skeleton" },
    });

    const approvalArtifact = submitForApproval(artifact, "command-lead");
    expect(approvalArtifact.state).toBe("needs-approval");
  });

  it("returns to approved after a passing review cycle", () => {
    const artifact = createArtifactRecord({
      id: "execution-1",
      kind: "execution-summary",
      state: "draft",
      payload: { summary: "done" },
    });

    const approved = approveArtifact(submitForApproval(artifact, "command-lead"), "command-lead");
    const executing = beginExecution(approved, "command-lead");
    const reviewResult = recordReviewResult({
      reviewResultId: "review-1",
      artifact: executing,
      reviewer: "review",
      decision: "pass",
    });
    const result = applyReviewResult({
      artifact: executing,
      reviewResult,
      actor: "command-lead",
    });

    expect(result.reviewResult.owner).toBe("review");
    expect(result.reviewResult.payload.decision).toBe("pass");
    expect(result.artifact.state).toBe("approved");
    expect(result.reviewResult.payload.gateVisible).toBe(true);
  });

  it("escalates after two rejection cycles instead of silently looping forever", () => {
    const artifact = createArtifactRecord({
      id: "execution-2",
      kind: "execution-summary",
      state: "draft",
      payload: { summary: "needs work" },
    });

    const approved = approveArtifact(submitForApproval(artifact, "command-lead"), "command-lead");
    const executing = beginExecution(approved, "command-lead");

    const firstReviewResult = recordReviewResult({
      reviewResultId: "review-2",
      artifact: executing,
      reviewer: "review",
      decision: "reject",
    });
    const firstRejection = applyReviewResult({
      artifact: executing,
      reviewResult: firstReviewResult,
      actor: "command-lead",
    });

    const secondApproved = approveArtifact(
      submitForApproval(firstRejection.artifact, "command-lead"),
      "command-lead",
    );
    const secondExecuting = beginExecution(secondApproved, "command-lead");
    const secondReviewResult = recordReviewResult({
      reviewResultId: "review-3",
      artifact: secondExecuting,
      reviewer: "review",
      decision: "reject",
      previousReviewResult: firstReviewResult,
    });
    const secondRejection = applyReviewResult({
      artifact: secondExecuting,
      reviewResult: secondReviewResult,
      actor: "command-lead",
    });

    expect(firstReviewResult.payload.decision).toBe("reject");
    expect(firstReviewResult.payload.rejectionCount).toBe(1);
    expect(firstRejection.artifact.state).toBe("draft");
    expect(secondReviewResult.payload.decision).toBe("escalate");
    expect(secondReviewResult.payload.rejectionCount).toBe(2);
    expect(secondRejection.artifact.state).toBe("needs-approval");
  });
});
