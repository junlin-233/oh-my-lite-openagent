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

  it("returns to approved after a passing result review cycle", () => {
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
      reviewer: "result-review",
      decision: "pass",
    });
    const result = applyReviewResult({
      artifact: executing,
      reviewResult,
      actor: "command-lead",
    });

    expect(result.reviewResult.owner).toBe("result-review");
    expect(result.reviewResult.payload.surface).toBe("result");
    expect(result.reviewResult.payload.reviewer).toBe("result-review");
    expect(result.reviewResult.payload.decision).toBe("pass");
    expect(result.reviewResult.payload.majorRejectionCount).toBe(0);
    expect(result.artifact.state).toBe("approved");
    expect(result.reviewResult.payload.gateVisible).toBe(true);
  });

  it("limits result review to Command Lead execution summaries", () => {
    const artifact = createArtifactRecord({
      id: "child-task-1",
      kind: "child-task-return-summary",
      state: "executing",
      payload: { summary: "task output" },
    });

    expect(() =>
      recordReviewResult({
        reviewResultId: "child-review-1",
        artifact,
        reviewer: "result-review",
        decision: "pass",
      }),
    ).toThrow(/child-task-return-summary is not reviewable/);
  });

  it("lets plan-review own plan artifacts and requires severity on rejection", () => {
    const artifact = createArtifactRecord({
      id: "plan-2",
      kind: "detailed-plan",
      state: "draft",
      payload: { summary: "plan" },
    });
    const executing = beginExecution(
      approveArtifact(submitForApproval(artifact, "command-lead"), "command-lead"),
      "command-lead",
    );

    expect(() =>
      recordReviewResult({
        reviewResultId: "wrong-reviewer",
        artifact: executing,
        reviewer: "result-review",
        decision: "pass",
      }),
    ).toThrow(/Only plan-review may review detailed-plan artifacts/);

    expect(() =>
      recordReviewResult({
        reviewResultId: "missing-severity",
        artifact: executing,
        reviewer: "plan-review",
        decision: "reject",
      }),
    ).toThrow(/must include minor or major severity/);

    const reviewResult = recordReviewResult({
      reviewResultId: "plan-review-1",
      artifact: executing,
      reviewer: "plan-review",
      decision: "reject",
      severity: "minor",
      findings: [
        {
          location: "plan.subtasks[0]",
          issue: "missing acceptance detail",
          passCriteria: "subtask deliverable is independently verifiable",
        },
      ],
    });

    expect(reviewResult.owner).toBe("plan-review");
    expect(reviewResult.payload.surface).toBe("plan");
    expect(reviewResult.payload.severity).toBe("minor");
    expect(reviewResult.payload.findings).toHaveLength(1);
  });

  it("escalates after the third major rejection instead of silently looping forever", () => {
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
      reviewer: "result-review",
      decision: "reject",
      severity: "major",
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
      reviewer: "result-review",
      decision: "reject",
      severity: "major",
      previousReviewResult: firstReviewResult,
    });
    const secondRejection = applyReviewResult({
      artifact: secondExecuting,
      reviewResult: secondReviewResult,
      actor: "command-lead",
    });

    const thirdApproved = approveArtifact(
      submitForApproval(secondRejection.artifact, "command-lead"),
      "command-lead",
    );
    const thirdExecuting = beginExecution(thirdApproved, "command-lead");
    const thirdReviewResult = recordReviewResult({
      reviewResultId: "review-4",
      artifact: thirdExecuting,
      reviewer: "result-review",
      decision: "reject",
      severity: "major",
      previousReviewResult: secondReviewResult,
    });
    const thirdRejection = applyReviewResult({
      artifact: thirdExecuting,
      reviewResult: thirdReviewResult,
      actor: "command-lead",
    });

    expect(firstReviewResult.payload.decision).toBe("reject");
    expect(firstReviewResult.payload.rejectionCount).toBe(1);
    expect(firstReviewResult.payload.majorRejectionCount).toBe(1);
    expect(firstRejection.artifact.state).toBe("draft");
    expect(secondReviewResult.payload.decision).toBe("reject");
    expect(secondReviewResult.payload.rejectionCount).toBe(2);
    expect(secondReviewResult.payload.majorRejectionCount).toBe(2);
    expect(secondRejection.artifact.state).toBe("draft");
    expect(thirdReviewResult.payload.decision).toBe("escalate");
    expect(thirdReviewResult.payload.rejectionCount).toBe(3);
    expect(thirdReviewResult.payload.majorRejectionCount).toBe(3);
    expect(thirdRejection.artifact.state).toBe("needs-approval");
  });
});
