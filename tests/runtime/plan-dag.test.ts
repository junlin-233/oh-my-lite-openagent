import {
  buildTaskDAG,
  normalizeTaskDispatchConfig,
  resolveDispatchProfile,
  validatePlanPayload,
} from "../../.opencode/lib/runtime/plan-dag.js";

const validPlan = {
  plan: {
    subtasks: [
      {
        id: "scan",
        depends_on: [],
        attributes: ["research"],
        deliverable: "Repository context notes",
        description: "Inspect the repository shape",
      },
      {
        id: "implement",
        depends_on: ["scan"],
        attributes: ["code"],
        deliverable: "Patched source files",
        description: "Make the code change",
      },
      {
        id: "visual-check",
        depends_on: ["scan"],
        attributes: ["code", "multimodal"],
        deliverable: "Screenshot verification",
        description: "Verify the UI surface",
      },
    ],
  },
};

describe("plan DAG runtime contract", () => {
  it("validates the required plan.subtasks schema and infers execution waves", () => {
    const dag = buildTaskDAG(validPlan);

    expect(dag.concurrency).toBe(4);
    expect(dag.waves).toEqual([["scan"], ["implement", "visual-check"]]);
    expect(dag.nodes.find((node) => node.id === "scan")?.dependents).toEqual([
      "implement",
      "visual-check",
    ]);
  });

  it("uses configurable attribute dispatch instead of hard-coded model names", () => {
    const dag = buildTaskDAG(validPlan, {
      concurrency: 5,
      attributeProfileMap: {
        code: "fast-code-profile",
        multimodal: "vision-profile",
      },
      attributePriority: ["multimodal", "code"],
    });

    expect(dag.concurrency).toBe(5);
    expect(dag.nodes.find((node) => node.id === "implement")?.dispatch).toEqual({
      profile: "fast-code-profile",
      matchedAttribute: "code",
    });
    expect(dag.nodes.find((node) => node.id === "visual-check")?.dispatch).toEqual({
      profile: "vision-profile",
      matchedAttribute: "multimodal",
    });
  });

  it("rejects unknown dependencies, duplicate ids, and cycles", () => {
    expect(validatePlanPayload({
      plan: {
        subtasks: [
          {
            id: "a",
            depends_on: ["missing"],
            attributes: [],
            deliverable: "A",
            description: "A",
          },
          {
            id: "a",
            depends_on: [],
            attributes: [],
            deliverable: "B",
            description: "B",
          },
        ],
      },
    }).errors).toEqual([
      "plan.subtasks[1].id duplicates a.",
      "Subtask a depends on unknown subtask missing.",
    ]);

    expect(validatePlanPayload({
      plan: {
        subtasks: [
          {
            id: "a",
            depends_on: ["b"],
            attributes: [],
            deliverable: "A",
            description: "A",
          },
          {
            id: "b",
            depends_on: ["a"],
            attributes: [],
            deliverable: "B",
            description: "B",
          },
        ],
      },
    }).errors.some((error) => error.includes("cycle"))).toBe(true);
  });

  it("enforces the architecture concurrency bounds of 3 to 5", () => {
    expect(() => normalizeTaskDispatchConfig({ concurrency: 2 })).toThrow(/from 3 to 5/);
    expect(() => normalizeTaskDispatchConfig({ concurrency: 6 })).toThrow(/from 3 to 5/);
  });

  it("falls back to the default dispatch profile when no configured attribute matches", () => {
    expect(resolveDispatchProfile(["unknown"], { defaultProfile: "general" })).toEqual({
      profile: "general",
    });
  });

  it("can include Task Lead profile model metadata when provider models are supplied", () => {
    const dag = buildTaskDAG(validPlan, {
      availableModels: [
        { id: "opencode/claude-sonnet-4-6" },
        { id: "google/gemini-3.1-pro" },
      ],
    });

    expect(dag.nodes.find((node) => node.id === "implement")?.dispatch).toMatchObject({
      profile: "code",
      matchedAttribute: "code",
      recommendedModel: "opencode/claude-sonnet-4-6",
    });
    expect(dag.nodes.find((node) => node.id === "visual-check")?.dispatch).toMatchObject({
      profile: "visual",
      matchedAttribute: "multimodal",
      recommendedModel: "google/gemini-3.1-pro",
    });
  });
});
