import {
  applyRoleModelConfig,
  listProviderModelsFromResponse,
  listProviderModels,
  mergeProviderModels,
  summarizeRoleModels,
} from "../../.opencode/lib/runtime/model-config.js";

describe("role model configuration", () => {
  it("lists provider models from OpenCode config", () => {
    const models = listProviderModels({
      provider: {
        fish: {
          models: {
            "gpt-5.4": { name: "GPT-5.4" },
            "gpt-5.4-mini": { name: "GPT-5.4 Mini" },
          },
        },
      },
    });

    expect(models.map((model) => model.id)).toEqual([
      "fish/gpt-5.4",
      "fish/gpt-5.4-mini",
    ]);
  });

  it("lists provider models from OpenCode provider API responses", () => {
    const models = listProviderModelsFromResponse({
      data: {
        providers: [
          {
            id: "openai",
            models: {
              "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
              "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
            },
          },
        ],
      },
    });

    expect(models.map((model) => model.id)).toEqual([
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
    ]);
  });

  it("prefers runtime provider models while keeping JSON fallback models", () => {
    const models = mergeProviderModels(
      [{ provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" }],
      [
        { provider: "fish", model: "gpt-5.4", id: "fish/gpt-5.4" },
        { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      ],
    );

    expect(models.map((model) => model.id)).toEqual([
      "fish/gpt-5.4",
      "openai/gpt-5.4",
    ]);
  });

  it("summarizes inherited and role-specific models", () => {
    const summary = summarizeRoleModels({
      model: "fish/gpt-5.4",
      agent: {
        "command-lead": { mode: "primary" },
        explore: { mode: "subagent", model: "fish/gpt-5.4-mini" },
      },
    });

    expect(summary.find((role) => role.role === "command-lead")).toMatchObject({
      effectiveModel: "fish/gpt-5.4",
      inheritsGlobal: true,
    });
    expect(summary.find((role) => role.role === "explore")).toMatchObject({
      configuredModel: "fish/gpt-5.4-mini",
      effectiveModel: "fish/gpt-5.4-mini",
      inheritsGlobal: false,
    });
  });

  it("applies validated model assignments only to known roles", () => {
    const config: Record<string, unknown> = {
      agent: {
        "command-lead": { mode: "primary" },
        explore: { mode: "subagent" },
      },
    };
    const result = applyRoleModelConfig(
      config,
      {
        "command-lead": "fish/gpt-5.4",
        explore: "fish/gpt-5.4-mini",
        unknown: "fish/gpt-5.4",
      },
      ["fish/gpt-5.4", "fish/gpt-5.4-mini"],
    );

    expect(result.changed).toEqual([
      { role: "command-lead", previous: undefined, next: "fish/gpt-5.4" },
      { role: "explore", previous: undefined, next: "fish/gpt-5.4-mini" },
    ]);
    expect(result.skipped).toEqual([{ role: "unknown", reason: "unknown role" }]);
    const agents = config.agent as Record<string, { model?: string }>;
    expect(agents["command-lead"]?.model).toBe("fish/gpt-5.4");
    expect(agents.explore?.model).toBe("fish/gpt-5.4-mini");
  });

  it("allows subscription models that are missing from the listed provider models", () => {
    const config: Record<string, unknown> = {
      agent: {
        "command-lead": { mode: "primary" },
      },
    };
    const result = applyRoleModelConfig(
      config,
      { "command-lead": "openai/gpt-5.4" },
      ["fish/gpt-5.4"],
    );

    expect(result.changed).toEqual([
      { role: "command-lead", previous: undefined, next: "openai/gpt-5.4" },
    ]);
    expect(result.warnings).toEqual([
      {
        role: "command-lead",
        warning: "model was not found in the provider list; writing it anyway",
      },
    ]);
  });
});
