import {
  DEFAULT_TASK_LEAD_PROFILES,
  buildDefaultAttributeProfileMap,
  formatTaskLeadProfileModelReport,
  resolveAutoTaskLeadProfileModels,
  resolveTaskLeadProfileDispatch,
} from "../../.opencode/lib/runtime/task-lead-profiles.js";

describe("task lead profile dispatch", () => {
  it("defines the expected lightweight default profiles", () => {
    expect(DEFAULT_TASK_LEAD_PROFILES.map((profile) => profile.name)).toEqual([
      "quick",
      "code",
      "research",
      "writing",
      "visual",
      "deep",
      "risk-high",
    ]);
  });

  it("maps attributes to profiles without adding task lead agents", () => {
    const map = buildDefaultAttributeProfileMap();

    expect(map.code).toBe("code");
    expect(map.multimodal).toBe("visual");
    expect(map["risk-high"]).toBe("risk-high");
    expect(map.docs).toBe("research");
  });

  it("uses priority so high-risk and multimodal attributes win", () => {
    expect(resolveTaskLeadProfileDispatch(["code", "multimodal"])).toMatchObject({
      profile: "visual",
      matchedAttribute: "multimodal",
    });
    expect(resolveTaskLeadProfileDispatch(["code", "security"])).toMatchObject({
      profile: "risk-high",
      matchedAttribute: "security",
    });
  });

  it("recommends models from the available pool by profile fallback patterns", () => {
    const dispatch = resolveTaskLeadProfileDispatch(["code"], {
      availableModels: [
        { id: "opencode-go/minimax-m2.7" },
        { id: "opencode/claude-sonnet-4-6" },
      ],
    });

    expect(dispatch).toMatchObject({
      profile: "code",
      matchedAttribute: "code",
      recommendedModel: "opencode/claude-sonnet-4-6",
    });
    expect(dispatch.fallbackChain).toEqual([
      "opencode/claude-sonnet-4-6",
      "opencode-go/minimax-m2.7",
    ]);
  });

  it("respects explicit profile model overrides before fallback matches", () => {
    const dispatch = resolveTaskLeadProfileDispatch(["quick"], {
      profileModelMap: { quick: "openai/gpt-5.4-mini" },
      availableModels: [{ id: "opencode/big-pickle" }],
    });

    expect(dispatch.recommendedModel).toBe("openai/gpt-5.4-mini");
    expect(dispatch.fallbackChain?.[0]).toBe("openai/gpt-5.4-mini");
  });

  it("formats auto profile model recommendations", () => {
    const result = resolveAutoTaskLeadProfileModels([
      { id: "openai/gpt-5.4-mini" },
      { id: "google/gemini-3.1-pro" },
    ]);
    const report = formatTaskLeadProfileModelReport(result);

    expect(result.assignments.quick).toBe("openai/gpt-5.4-mini");
    expect(result.assignments.visual).toBe("google/gemini-3.1-pro");
    expect(report).toContain("Task Lead profile model recommendations");
  });
});
