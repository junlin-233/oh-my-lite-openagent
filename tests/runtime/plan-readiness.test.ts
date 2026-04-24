import { validatePlanReadiness } from "../../.opencode/lib/runtime/plan-readiness.js";

const executablePlan = {
  plan_schema_version: "2.1",
  maturity_level: "M3",
  status: "reviewed",
  goals: ["[User Confirmed] ship the bounded change"],
  scope_boundaries: ["[User Confirmed] only runtime plan validation"],
  acceptance_criteria: ["[User Confirmed] readiness validator accepts the plan"],
  phase_plan: [
    {
      Goal: ["[User Confirmed] validate before execution"],
      Acceptance: ["[User Confirmed] bad plans are rejected"],
    },
  ],
  open_questions: [],
  plan: {
    subtasks: [
      {
        id: "validate",
        depends_on: [],
        attributes: ["code"],
        deliverable: "Plan readiness result",
        description: "Validate the plan payload before dispatch",
      },
    ],
  },
};

describe("plan readiness validation", () => {
  it("accepts M3 plans with required sections and a valid task DAG", () => {
    const result = validatePlanReadiness(executablePlan);

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.dag?.waves).toEqual([["validate"]]);
  });

  it("rejects M2 plans when open questions block the current phase", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      maturity_level: "M2",
      status: "draft",
      open_questions: [
        {
          question: "[Open Question] Which compatibility policy applies?",
          blocks_current_phase: true,
        },
      ],
    });

    expect(result.executable).toBe(false);
    expect(result.decision).toBe("revise");
    expect(result.errors).toContain("M2 plan has open_questions that block the current phase.");
  });

  it("rejects blocked or underspecified plans before Task Lead dispatch", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      status: "blocked",
      acceptance_criteria: [],
    });

    expect(result.executable).toBe(false);
    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("blocked plans are not executable.");
    expect(result.errors).toContain("acceptance_criteria must be present and non-empty before execution.");
  });

  it("rejects invalid DAG payloads through the same gate", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      plan: {
        subtasks: [
          {
            id: "execute",
            depends_on: ["missing"],
            attributes: ["code"],
            deliverable: "Patch",
            description: "Execute a missing dependency",
          },
        ],
      },
    });

    expect(result.executable).toBe(false);
    expect(result.errors.some((error) => error.includes("unknown subtask missing"))).toBe(true);
  });
});
