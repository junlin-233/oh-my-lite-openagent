import {
  applyRoleModelConfig,
  classifyModelFamily,
  classifyModelProvider,
  formatModelConfigReport,
  importModelPool,
  inferModelPoolPolicy,
  listKnownModelsForCredentialProviders,
  listProviderModelsFromResponse,
  listProviderModels,
  mergeProviderModels,
  resolveAutoModels,
  summarizeRoleModels,
} from "../../.opencode/lib/runtime/model-config.js";

describe("role model configuration", () => {
  it("lists provider models from OpenCode config", () => {
    const models = listProviderModels({
      provider: {
        opencode: {
          models: {
            "gpt-5.4": { name: "GPT-5.4" },
            "gpt-5.4-mini": { name: "GPT-5.4 Mini" },
          },
        },
      },
    });

    expect(models.map((model) => model.id)).toEqual([
      "opencode/gpt-5.4",
      "opencode/gpt-5.4-mini",
    ]);
    expect(models.map((model) => model.source)).toEqual([
      "opencode-subscription",
      "opencode-subscription",
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
    expect(models.map((model) => model.source)).toEqual([
      "api-provider",
      "api-provider",
    ]);
  });

  it("classifies subscription, api, gateway, and unknown providers", () => {
    expect(classifyModelProvider("fish")).toBe("unknown");
    expect(classifyModelProvider("opencode")).toBe("opencode-subscription");
    expect(classifyModelProvider("opencode-go")).toBe("opencode-subscription");
    expect(classifyModelProvider("openai")).toBe("api-provider");
    expect(classifyModelProvider("anthropic")).toBe("api-provider");
    expect(classifyModelProvider("google")).toBe("api-provider");
    expect(classifyModelProvider("vercel")).toBe("gateway");
    expect(classifyModelProvider("custom")).toBe("unknown");
  });

  it("classifies model families with codex taking precedence over gpt", () => {
    expect(classifyModelFamily("openai/gpt-5.4")).toBe("gpt");
    expect(classifyModelFamily("openai/gpt-5.3-codex")).toBe("codex");
    expect(classifyModelFamily("opencode/claude-sonnet-4-6")).toBe("claude");
    expect(classifyModelFamily("google/gemini-3-flash")).toBe("gemini");
    expect(classifyModelFamily("opencode-go/kimi-k2.5")).toBe("kimi");
  });

  it("imports all discovered provider models by default and excludes codex backend models", () => {
    const pool = importModelPool([
      { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
      { provider: "opencode", model: "gpt-5.3-codex", id: "opencode/gpt-5.3-codex" },
      { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      { provider: "opencode-go", model: "kimi-k2.5", id: "opencode-go/kimi-k2.5" },
    ]);

    const importedIds = pool.map((model) => model.id);
    expect(importedIds).toEqual([
      "opencode-go/kimi-k2.5",
      "opencode/gpt-5.4",
      "openai/gpt-5.4",
    ].sort((left, right) => left.localeCompare(right)));
    expect(pool.find((model) => model.id === "opencode-go/kimi-k2.5")).toMatchObject({
      source: "opencode-subscription",
      family: "kimi",
    });
  });

  it("can import an explicitly narrowed family-limited subscription pool", () => {
    const pool = importModelPool(
      [
        { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
        { provider: "opencode", model: "claude-sonnet-4-6", id: "opencode/claude-sonnet-4-6" },
        { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      ],
      { source: "opencode-subscription", familyPreference: ["claude"] },
    );

    expect(pool.map((model) => model.id)).toEqual(["opencode/claude-sonnet-4-6"]);
  });

  it("does not use the global model as a hard model-pool filter", () => {
    const inferred = inferModelPoolPolicy(
      { model: "openai/gpt-5.4" },
      {},
    );

    expect(inferred.policy).toEqual({
      source: "all",
      allowCodexBackend: false,
    });
    expect(inferred.reason).toContain("openai/gpt-5.4");
  });

  it("adds known subscription models for connected credential-only providers", () => {
    const models = listKnownModelsForCredentialProviders(["opencode-go"]);

    expect(models.map((model) => model.id)).toEqual([
      "opencode-go/glm-5",
      "opencode-go/kimi-k2.5",
      "opencode-go/minimax-m2.7",
      "opencode-go/minimax-m2.7-highspeed",
    ]);
    expect(models.every((model) => model.source === "opencode-subscription")).toBe(true);
    expect(models.every((model) => model.origin === "credential-provider-fallback")).toBe(true);
  });

  it("falls back to all discovered providers when no global model exists", () => {
    const inferred = inferModelPoolPolicy({}, {});

    expect(inferred.policy).toEqual({
      source: "all",
      allowCodexBackend: false,
    });
    expect(inferred.reason).toContain("No global model");
  });

  it("shows provider source in model configuration reports", () => {
    const report = formatModelConfigReport({
      roles: summarizeRoleModels({ model: "openai/gpt-5.4" }),
      models: [
        {
          provider: "opencode",
          model: "gpt-5.4",
          id: "opencode/gpt-5.4",
          source: "opencode-subscription",
        },
        {
          provider: "openai",
          model: "gpt-5.4",
          id: "openai/gpt-5.4",
          source: "api-provider",
        },
      ],
    });

    expect(report).toContain("opencode/gpt-5.4 [opencode-subscription/gpt");
    expect(report).toContain("openai/gpt-5.4 [api-provider/gpt");
  });

  it("prefers runtime provider models while keeping JSON fallback models", () => {
    const models = mergeProviderModels(
      [{ provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" }],
      [
        { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
        { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      ],
    );

    expect(models.map((model) => model.id)).toEqual([
      "openai/gpt-5.4",
      "opencode/gpt-5.4",
    ]);
  });

  it("summarizes inherited and role-specific models", () => {
    const summary = summarizeRoleModels({
      model: "openai/gpt-5.4",
      agent: {
        "command-lead": { mode: "primary" },
        explore: { mode: "subagent", model: "openai/gpt-5.4-mini" },
      },
    });

    expect(summary.find((role) => role.role === "command-lead")).toMatchObject({
      effectiveModel: "openai/gpt-5.4",
      inheritsGlobal: true,
    });
    expect(summary.find((role) => role.role === "explore")).toMatchObject({
      configuredModel: "openai/gpt-5.4-mini",
      effectiveModel: "openai/gpt-5.4-mini",
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
        "command-lead": "openai/gpt-5.4",
        explore: "openai/gpt-5.4-mini",
        unknown: "openai/gpt-5.4",
      },
      ["openai/gpt-5.4", "openai/gpt-5.4-mini"],
    );

    expect(result.changed).toEqual([
      { role: "command-lead", previous: undefined, next: "openai/gpt-5.4" },
      { role: "explore", previous: undefined, next: "openai/gpt-5.4-mini" },
    ]);
    expect(result.skipped).toEqual([{ role: "unknown", reason: "unknown role" }]);
    const agents = config.agent as Record<string, { model?: string }>;
    expect(agents["command-lead"]?.model).toBe("openai/gpt-5.4");
    expect(agents.explore?.model).toBe("openai/gpt-5.4-mini");
  });

  it("rejects models that are missing from the imported model pool by default", () => {
    const config: Record<string, unknown> = {
      agent: {
        "command-lead": { mode: "primary" },
      },
    };
    const result = applyRoleModelConfig(
      config,
      { "command-lead": "openai/gpt-5.4" },
      ["opencode/gpt-5.4"],
    );

    expect(result.changed).toEqual([]);
    expect(result.skipped).toEqual([
      { role: "command-lead", reason: "model is not in the imported model pool" },
    ]);
    const agents = config.agent as Record<string, { model?: string }>;
    expect(agents["command-lead"]?.model).toBeUndefined();
  });

  it("can explicitly allow unavailable model assignments for escape hatches", () => {
    const config: Record<string, unknown> = {
      agent: {
        "command-lead": { mode: "primary" },
      },
    };
    const result = applyRoleModelConfig(
      config,
      { "command-lead": "openai/gpt-5.4" },
      ["opencode/gpt-5.4"],
      { allowUnavailableModels: true },
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

  it("resolves automatic role model assignments from available provider models", () => {
    const result = resolveAutoModels([
      { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
      { provider: "openai", model: "gpt-5.4-mini", id: "openai/gpt-5.4-mini" },
      { provider: "google", model: "gemini-3-flash", id: "google/gemini-3-flash" },
    ]);

    expect(result.assignments["command-lead"]).toBe("anthropic/claude-opus-4-7");
    expect(result.assignments.explore).toBe("openai/gpt-5.4-mini");
    expect(result.assignments["deep-plan-builder"]).toBe("google/gemini-3-flash");
  });
});
