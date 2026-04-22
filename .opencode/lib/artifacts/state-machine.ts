import type { CanonicalState, RoleName } from "../contracts.js";
import type { ArtifactRecord } from "./schema.js";

export const STATE_TRANSITIONS: Readonly<Record<CanonicalState, readonly CanonicalState[]>> = {
  draft: ["needs-approval"],
  "needs-approval": ["approved"],
  approved: ["executing"],
  executing: ["reviewed"],
  reviewed: ["needs-approval", "draft", "approved"],
};

export const STATE_ADVANCE_OWNER: RoleName = "command-lead";

export function canTransition(from: CanonicalState, to: CanonicalState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

export function transitionArtifact<TPayload>(input: {
  artifact: ArtifactRecord<TPayload>;
  nextState: CanonicalState;
  actor: RoleName;
}): ArtifactRecord<TPayload> {
  if (input.actor !== STATE_ADVANCE_OWNER) {
    throw new Error(`Only ${STATE_ADVANCE_OWNER} may advance canonical state.`);
  }

  if (!canTransition(input.artifact.state, input.nextState)) {
    throw new Error(
      `Invalid canonical transition: ${input.artifact.state} -> ${input.nextState}`,
    );
  }

  return {
    ...input.artifact,
    state: input.nextState,
  };
}
