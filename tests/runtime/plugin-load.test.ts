import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("plugin safety", () => {
  it("loads without touching the client during initialization", async () => {
    const client = new Proxy(
      {},
      {
        get() {
          throw new Error("client should not be touched during init");
        },
      },
    );

    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
        client,
      }),
    );

    expect(hooks).toBeTruthy();
  });

  it("registers only provider-safe namespaced custom tools", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    const toolNames = Object.keys(hooks.tool ?? {});
    expect(toolNames).not.toHaveLength(0);
    expect(toolNames).toContain("bounded_lite_plan_dag");
    expect(toolNames).toContain("bounded_lite_plan_readiness");
    expect(toolNames).toContain("bounded_lite_plan_artifact");
    expect(toolNames.every((toolName) => toolName.startsWith("bounded_lite_"))).toBe(true);
    expect(toolNames.every((toolName) => /^[a-zA-Z0-9_-]+$/.test(toolName))).toBe(true);
  });

  it("allows bounded lite plugin tools without extra permission prompts", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );
    const modelOutput: { status: "allow" | "ask" | "deny" } = { status: "deny" };
    const planOutput: { status: "allow" | "ask" | "deny" } = { status: "deny" };

    await hooks["permission.ask"]?.(
      { tool: "bounded_lite_model_config", action: "execute" },
      modelOutput,
    );
    await hooks["permission.ask"]?.(
      { tool: "bounded_lite_plan_artifact", action: "execute" },
      planOutput,
    );

    expect(modelOutput.status).toBe("allow");
    expect(planOutput.status).toBe("allow");
  });

  it("returns JSON auto recommendations with imported model pool", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-models-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "auto" },
        {
          directory: process.cwd(),
          client: {
            config: {
              providers: async () => ({
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
              }),
            },
          },
        },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        available_models?: Array<{ id: string }>;
        recommendations?: unknown;
      };

      expect(output.ok).toBe(true);
      expect(output.action).toBe("auto");
      expect(output.applied).toBe(false);
      expect(output.available_models?.map((item) => item.id)).toContain("openai/gpt-5.4");
      expect(output.recommendations).toBeTruthy();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("normalizes plugin taskLeadProfiles from legacy strings and ignores unknown keys", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-tasklead-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        model: "openai/gpt-5.4",
        agent: {
          "task-lead": { mode: "subagent", model: "openai/gpt-5.4" },
        },
        plugin: [["./.opencode/plugins/bounded-lite.ts", {
          mode: "full",
          configDir,
          taskLeadProfiles: {
            quick: "openai/gpt-5.4-mini",
            multimodal: "openai/gpt-5.4",
          },
        }]],
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: configDir },
        { configDir },
      );
      await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          taskLeadProfileAssignments: {
            quick: "openai/gpt-5.4-mini",
            multimodal: "openai/gpt-5.4",
          },
        },
        { directory: configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute({ action: "list" }, { directory: configDir }) as {
        profile_assignments?: Record<string, string>;
      };

      expect(output.profile_assignments?.quick).toBe("openai/gpt-5.4-mini");
      expect(output.profile_assignments?.multimodal).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("returns missing action validation error for empty payload", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await hooks.tool?.bounded_lite_model_config?.execute({}, { directory: process.cwd() }) as {
      ok: boolean;
      validation_errors?: Array<{ code: string }>;
    };

    expect(output.ok).toBe(false);
    expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_MISSING_ACTION");
  });

  it("returns unknown action validation error for invalid action", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await hooks.tool?.bounded_lite_model_config?.execute(
      { action: "noop" },
      { directory: process.cwd() },
    ) as {
      ok: boolean;
      validation_errors?: Array<{ code: string }>;
    };

    expect(output.ok).toBe(false);
    expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_UNKNOWN_ACTION");
  });

  it("returns unknown field validation error for strict top-level payload", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await hooks.tool?.bounded_lite_model_config?.execute(
      { action: "list", confirm: true },
      { directory: process.cwd() },
    ) as {
      ok: boolean;
      validation_errors?: Array<{ code: string }>;
    };

    expect(output.ok).toBe(false);
    expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_UNKNOWN_FIELD");
  });

  it("returns invalid payload validation error for non-object payload", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const outputs = await Promise.all([
      hooks.tool?.bounded_lite_model_config?.execute(
        null as unknown as Record<string, unknown>,
        { directory: process.cwd() },
      ),
      hooks.tool?.bounded_lite_model_config?.execute(
        "list" as unknown as Record<string, unknown>,
        { directory: process.cwd() },
      ),
      hooks.tool?.bounded_lite_model_config?.execute(
        [] as unknown as Record<string, unknown>,
        { directory: process.cwd() },
      ),
    ]) as Array<{ ok: boolean; validation_errors?: Array<{ code: string }> }>;

    for (const output of outputs) {
      expect(output.ok).toBe(false);
      expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_INVALID_PAYLOAD");
    }
  });

  it("keeps payload through adapter and applies taskLeadProfileAssignments", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-payload-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        model: "openai/gpt-5.4",
        agent: {
          "task-lead": { mode: "subagent", model: "openai/gpt-5.4" },
        },
        plugin: [["./.opencode/plugins/bounded-lite.ts", {
          mode: "full",
          configDir,
        }]],
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: configDir },
        { configDir },
      );

      await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          taskLeadProfileAssignments: {
            quick: "openai/gpt-5.4-mini",
          },
        },
        { directory: configDir },
      );

      const output = await hooks.tool?.bounded_lite_model_config?.execute({ action: "list" }, { directory: configDir }) as {
        profile_assignments?: Record<string, string>;
      };
      expect(output.profile_assignments?.quick).toBe("openai/gpt-5.4-mini");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("accepts import payload with nested policy field", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-policy-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "import",
          policy: {
            source: "all",
            allowCodexBackend: false,
          },
        },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean };

      expect(output).toMatchObject({ ok: true, action: "import", applied: false });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("accepts auto payload with familyPreference field", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-family-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "auto",
          familyPreference: ["gpt"],
        },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean };

      expect(output).toMatchObject({ ok: true, action: "auto", applied: false });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("accepts import payload with providerPreference and top-level source", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-providerpref-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "import",
          source: "all",
          providerPreference: ["openai"],
        },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean };

      expect(output).toMatchObject({ ok: true, action: "import", applied: false });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("accepts import payload with top-level allowCodexBackend", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-codex-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "import",
          allowCodexBackend: true,
        },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean };

      expect(output).toMatchObject({ ok: true, action: "import", applied: false });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("uses warning-compatible apply for out-of-pool role model ids", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-warning-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: {
          "command-lead": { mode: "primary" },
        },
        provider: {
          opencode: {
            models: {
              "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
            },
          },
        },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );

      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: {
            "command-lead": "openai/gpt-5.4",
          },
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        changed_keys?: string[];
        warnings?: string[];
      };

      expect(output).toMatchObject({ ok: true, action: "apply", applied: true });
      expect(output.changed_keys).toContain("assignments.command-lead");
      expect(output.warnings?.join("\n")).toContain("model was not found in the provider list; writing it anyway");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps ok=true for partial apply success and reports skipped items as warnings", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-partial-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: { "command-lead": { mode: "primary" } },
        provider: { openai: { models: { "gpt-5.4": { id: "gpt-5.4" } } } },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: {
            "command-lead": "openai/gpt-5.4",
            unknown: "openai/gpt-5.4",
          },
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        changed_keys?: string[];
        warnings?: string[];
        validation_errors?: Array<{ code: string }>;
      };

      expect(output).toMatchObject({ ok: true, action: "apply", applied: true });
      expect(output.changed_keys).toContain("assignments.command-lead");
      expect(output.warnings?.join("\n")).toContain("unknown: unknown role");
      expect(output.validation_errors).toBeUndefined();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("returns pool unavailable error when apply cannot build any model pool", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-no-pool-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: {
          "command-lead": { mode: "primary" },
        },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );

      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: {
            "command-lead": "openai/gpt-5.4",
          },
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        validation_errors?: Array<{ code: string }>;
      };
      expect(output).toMatchObject({ ok: false, action: "apply", applied: false });
      expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_POOL_UNAVAILABLE");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("is idempotent: second apply reports no-op", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-idempotent-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: { "command-lead": { mode: "primary" } },
        provider: { openai: { models: { "gpt-5.4": { id: "gpt-5.4" } } } },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "apply", assignments: { "command-lead": "openai/gpt-5.4" } },
        { directory: process.cwd() },
      );

      const second = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "apply", assignments: { "command-lead": "openai/gpt-5.4" } },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean; changed_keys?: string[] };

      expect(second).toMatchObject({ ok: true, action: "apply", applied: false });
      expect(second.changed_keys).toEqual([]);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("supports E2E confirm=false without apply writes", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-e2e-cancel-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: { "command-lead": { mode: "primary" } },
        provider: { openai: { models: { "gpt-5.4": { id: "gpt-5.4" }, "gpt-5.4-mini": { id: "gpt-5.4-mini" } } } },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const autoPreview = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "auto" },
        { directory: process.cwd() },
      ) as { recommendations?: { roles?: Record<string, string> } };

      expect(autoPreview.recommendations?.roles).toBeTruthy();
      const listed = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "list" },
        { directory: process.cwd() },
      ) as { role_assignments?: Record<string, string> };

      expect(listed.role_assignments?.["command-lead"]).toBeUndefined();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("supports E2E confirm=true with import->auto->apply->list", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-modelcfg-e2e-confirm-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
        agent: { "command-lead": { mode: "primary" } },
        provider: { openai: { models: { "gpt-5.4": { id: "gpt-5.4" }, "gpt-5.4-mini": { id: "gpt-5.4-mini" } } } },
      }, null, 2)}\n`);

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const imported = await hooks.tool?.bounded_lite_model_config?.execute({ action: "import" }, { directory: process.cwd() }) as {
        ok: boolean;
        action: string;
      };
      expect(imported).toMatchObject({ ok: true, action: "import" });

      const autoPreview = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "auto" },
        { directory: process.cwd() },
      ) as { recommendations?: { roles?: Record<string, string> } };
      const roles = autoPreview.recommendations?.roles ?? {};
      expect(Object.keys(roles).length).toBeGreaterThan(0);

      const apply = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "apply", assignments: roles },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string };
      expect(apply).toMatchObject({ ok: true, action: "apply" });

      const listed = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "list" },
        { directory: process.cwd() },
      ) as { role_assignments?: Record<string, string> };
      expect(listed.role_assignments?.["command-lead"]).toBeTruthy();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
