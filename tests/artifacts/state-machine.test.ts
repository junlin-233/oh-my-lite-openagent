import { createArtifactRecord } from "../../.opencode/lib/artifacts/schema.js";
import {
  STATE_ADVANCE_OWNER,
  STATE_TRANSITIONS,
  canTransition,
  transitionArtifact,
} from "../../.opencode/lib/artifacts/state-machine.js";
import { CANONICAL_STATES } from "../../.opencode/lib/contracts.js";

describe("canonical state machine", () => {
  it("keeps the five canonical states exactly as documented", () => {
    expect(CANONICAL_STATES).toEqual([
      "draft",
      "needs-approval",
      "approved",
      "executing",
      "reviewed",
    ]);
  });

  it("allows only the documented transitions", () => {
    expect(STATE_TRANSITIONS).toEqual({
      draft: ["needs-approval"],
      "needs-approval": ["approved"],
      approved: ["executing"],
      executing: ["reviewed"],
      reviewed: ["needs-approval", "draft", "approved"],
    });

    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("reviewed", "approved")).toBe(true);
  });

  it("allows only Command Lead to advance canonical state", () => {
    const artifact = createArtifactRecord({
      id: "plan-1",
      kind: "plan-skeleton",
      state: "draft",
      payload: { summary: "skeleton" },
    });

    expect(STATE_ADVANCE_OWNER).toBe("command-lead");

    expect(() =>
      transitionArtifact({
        artifact,
        nextState: "needs-approval",
        actor: "review",
      }),
    ).toThrow(/Only command-lead may advance canonical state/);

    expect(
      transitionArtifact({
        artifact,
        nextState: "needs-approval",
        actor: "command-lead",
      }).state,
    ).toBe("needs-approval");
  });
});
