import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import { parseFrontmatter, writePlanArtifact } from "../../.opencode/lib/runtime/plan-artifact.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function execModelConfig(
  hooks: ReturnType<typeof createBoundedLitePlugin>,
  args: Record<string, unknown>,
  context: any,
): Promise<any> {
  const raw = await hooks.tool?.bounded_lite_model_config?.execute(args, context);
  if (raw && typeof raw === "object" && "output" in raw && typeof (raw as { output?: unknown }).output === "string") {
    return JSON.parse((raw as { output: string }).output);
  }
  return raw;
}

async function execPlanArtifact(
  hooks: ReturnType<typeof createBoundedLitePlugin>,
  args: Record<string, unknown>,
  context: any,
): Promise<any> {
  const raw = await hooks.tool?.bounded_lite_plan_artifact?.execute(args, context);
  if (raw && typeof raw === "object" && "output" in raw && typeof (raw as { output?: unknown }).output === "string") {
    return JSON.parse((raw as { output: string }).output);
  }
  return raw;
}

async function readPlanFrontmatter(configDir: string, planPath: string): Promise<Record<string, string>> {
  const content = await readFile(path.join(configDir, "openplan", ...planPath.split("/")), "utf8");
  return parseFrontmatter(content);
}

describe("plugin safety", () => {
  const otherSessionKey = "20260518-1130-z9y8x7w6";
  const otherSessionStartedAt = "2026-05-18T03:30:00Z";

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

  it("declares bounded_lite_model_config action argument in tool schema", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    const args = hooks.tool?.bounded_lite_model_config?.args as Record<string, unknown> | undefined;
    expect(args).toBeTruthy();
    expect(args && "action" in args).toBe(true);
  });

  it("blocks task delegation for /agent-models in tool.execute.before", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    expect(() => hooks["tool.execute.before"]?.(
      { tool: "task", args: { command: "/agent-models", prompt: "/agent-models" } },
      { args: { command: "/agent-models", prompt: "/agent-models" } },
    )).toThrow("/agent-models must be executed directly by command-lead");
  });

  it("returns JSON auto recommendations with imported model pool", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-models-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await execModelConfig(
        hooks,
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
      await execModelConfig(
        hooks,
        {
          action: "apply",
          taskLeadProfileAssignments: {
            quick: "openai/gpt-5.4-mini",
            multimodal: "openai/gpt-5.4",
          },
        },
        { directory: configDir },
      );
      const output = await execModelConfig(hooks, { action: "list" }, { directory: configDir }) as {
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
    const output = await execModelConfig(hooks, {}, { directory: process.cwd() }) as {
      ok: boolean;
      validation_errors?: Array<{ code: string }>;
    };

    expect(output.ok).toBe(false);
    expect(output.validation_errors?.[0]?.code).toBe("MODELCFG_ERR_MISSING_ACTION");
  });

  it("returns structured openplan create result for bounded_lite_plan_artifact", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const output = await execPlanArtifact(
        hooks,
        {
          action: "write",
          title: "路由方案设计",
          markdown: "# Plan",
          filenameHint: "routing-plan.md",
          generatedBy: "command-lead",
          maturityLevel: "M2",
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        planId: string;
        path: string;
        indexPath: string;
        sessionKey: string;
        bytes: number;
        status: string;
        operation: string;
      };

      expect(output.ok).toBe(true);
      expect(output.action).toBe("write");
      expect(output.applied).toBe(true);
      expect(output.planId).toMatch(/^[a-z0-9]{8}$/);
      expect(output.path).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}\/routing-plan\.md$/);
      expect(output.indexPath).toBe("openplan/index.jsonl");
      expect(output.sessionKey).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}$/);
      expect(output.bytes).toBeGreaterThan(0);
      expect(output.status).toBe("draft");
      expect(output.operation).toBe("create");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("auto-injects runtime session metadata for create when the model omits session fields", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-autosession-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const output = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "自动注入会话元数据测试",
          markdown: "# 自动注入会话元数据测试",
          filenameHint: "auto-session-plan.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        path: string;
        planId: string;
        sessionKey: string;
        operation: string;
      };

      expect(output.ok).toBe(true);
      expect(output.operation).toBe("create");
      expect(output.path).toContain("auto-session-plan.md");
      expect(output.planId).toMatch(/^[a-z0-9]{8}$/);
      expect(output.sessionKey).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}$/);
      expect(output.sessionKey).not.toContain("-0000-");

      const frontmatter = await readPlanFrontmatter(configDir, output.path);
      expect(frontmatter.session_key).toBe(output.sessionKey);
      expect(frontmatter.session_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(frontmatter.plan_id).toBe(output.planId);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects model-supplied session metadata and planId", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-override-session-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const output = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "覆盖伪造元数据测试",
          markdown: "# 覆盖伪造元数据测试",
          filenameHint: "override-metadata-plan.md",
          generatedBy: "command-lead",
          planId: "a1b2c3d4",
          sessionKey: "20260531-0930-a1b2c3d4",
          sessionStartedAt: "2026-05-31T01:30:00Z",
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        code: string;
        message: string;
      };

      expect(output.ok).toBe(false);
      expect(output.code).toBe("PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN");
      expect(output.message).toContain("sessionKey");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects missing generatedBy for create bounded_lite_plan_artifact", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await execPlanArtifact(
      hooks,
      { action: "write", title: "A", markdown: "# A" },
      { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    expect(output.ok).toBe(false);
    expect(output.code).toBe("PLANART_ERR_MISSING_GENERATED_BY");
    expect(output.message).toContain("generatedBy is required");
  });

  it("declares bounded_lite_plan_artifact action argument in tool schema", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    const args = hooks.tool?.bounded_lite_plan_artifact?.args as Record<string, unknown> | undefined;
    expect(args).toBeTruthy();
    expect(args && "action" in args).toBe(true);
    expect(args && "sessionKey" in args).toBe(false);
    expect(args && "sessionStartedAt" in args).toBe(false);
    expect(args && "planId" in args).toBe(false);
  });

  it("rejects model-supplied system identity fields for bounded_lite_plan_artifact", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });

    const cases: Array<{ payload: Record<string, unknown>; field: string }> = [
      { payload: { action: "write", title: "A", markdown: "# A", filenameHint: "a.md", generatedBy: "command-lead", sessionKey: "20260518-1030-a1b2c3d4" }, field: "sessionKey" },
      { payload: { action: "write", title: "A", markdown: "# A", filenameHint: "a.md", generatedBy: "command-lead", sessionStartedAt: "2026-05-18T02:30:00Z" }, field: "sessionStartedAt" },
      { payload: { action: "write", title: "A", markdown: "# A", filenameHint: "a.md", generatedBy: "command-lead", planId: "a1b2c3d4" }, field: "planId" },
    ];

    for (const testCase of cases) {
      const output = await execPlanArtifact(hooks, testCase.payload, { directory: process.cwd() }) as {
        ok: boolean;
        code: string;
        message: string;
      };

      expect(output.ok).toBe(false);
      expect(output.code).toBe("PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN");
      expect(output.message).toContain(testCase.field);
    }
  });

  it("returns missing action validation error with expected actions for empty plan-artifact payload", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await execPlanArtifact(
      hooks,
      {} as Record<string, unknown>,
      { directory: process.cwd() },
    ) as {
      ok: boolean;
      code: string;
      message: string;
      expected?: { action?: string[] };
    };

    expect(output.ok).toBe(false);
    expect(output.code).toBe("PLANART_ERR_MISSING_ACTION");
    expect(output.message).toContain("requires action");
    expect(output.expected?.action).toEqual(["write", "rebuild"]);
  });

  it("rejects out-of-scope fields and non-write actions for bounded_lite_plan_artifact", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });

    const unknownField = await execPlanArtifact(
      hooks,
      {
        action: "write",
        title: "A",
        markdown: "# A",
        filenameHint: "a.md",
        generatedBy: "command-lead",
        unsupportedField: "x",
      },
      { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    const wrongAction = await execPlanArtifact(
      hooks,
      {
        action: "noop",
        operation: "update",
        markdown: "# A",
        generatedBy: "command-lead",
      },
      { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    const invalidExtension = await execPlanArtifact(
      hooks,
      {
        action: "write",
        title: "A",
        markdown: "# A",
        filenameHint: "a.txt",
        generatedBy: "command-lead",
      },
      { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    expect(unknownField.ok).toBe(false);
    expect(unknownField.code).toBe("PLANART_ERR_UNKNOWN_FIELD");
    expect(wrongAction.ok).toBe(false);
    expect(wrongAction.code).toBe("PLANART_ERR_UNKNOWN_ACTION");
    expect(invalidExtension.ok).toBe(false);
    expect(invalidExtension.code).toBe("PLANART_ERR_INVALID_FILENAME_HINT");
  });

  it("supports same-session update payload for bounded_lite_plan_artifact", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-update-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const created = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "路由方案设计",
          markdown: "# Plan",
          filenameHint: "routing-plan.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { path: string };

      const updated = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "update",
          targetPlanRef: created.path,
          markdown: "# Plan\nupdated",
          status: "reviewed",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        path: string;
        status: string;
        operation: string;
      };

      expect(updated.ok).toBe(true);
      expect(updated.action).toBe("write");
      expect(updated.applied).toBe(true);
      expect(updated.path).toBe(created.path);
      expect(updated.status).toBe("reviewed");
      expect(updated.operation).toBe("update");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("supports update from a fresh plugin instance by restoring persisted session context", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-fresh-instance-update-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooksA = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const created = await execPlanArtifact(
        hooksA,
        {
          action: "write",
          operation: "create",
          title: "实例 A 创建",
          markdown: "# Created by A",
          filenameHint: "fresh-update.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string; sessionKey: string };

      expect(created.ok).toBe(true);

      const hooksB = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const updated = await execPlanArtifact(
        hooksB,
        {
          action: "write",
          operation: "update",
          targetPlanRef: created.path,
          markdown: "# Updated by B",
          status: "reviewed",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string; status: string; operation: string; sessionKey: string };

      expect(updated.ok).toBe(true);
      expect(updated.path).toBe(created.path);
      expect(updated.status).toBe("reviewed");
      expect(updated.operation).toBe("update");
      expect(updated.sessionKey).toBe(created.sessionKey);

      const frontmatter = await readPlanFrontmatter(configDir, created.path);
      expect(frontmatter.session_key).toBe(created.sessionKey);
      expect(frontmatter.operation).toBe("update");
      expect(frontmatter.status).toBe("reviewed");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("supports cross-session provenance create for bounded_lite_plan_artifact", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-provenance-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const source = await writePlanArtifact({
        projectRoot: process.cwd(),
        configDir,
        action: "write",
        operation: "create",
        title: "Source",
        markdown: "# Source",
        systemIdentity: {
          sessionKey: "20260518-1130-z9y8x7w6",
          sessionStartedAt: "2026-05-18T03:30:00Z",
          planId: "a1b2c3d4",
        },
        filenameHint: "source.md",
        generatedBy: "command-lead",
      });

      const derived = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "Derived",
          markdown: "# Derived",
          filenameHint: "derived.md",
          generatedBy: "command-lead",
          sourcePlanRef: source.path,
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string; operation: string };

      expect(derived.ok).toBe(true);
      expect(derived.operation).toBe("create");
      expect(derived.path).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}\/derived\.md$/);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("supports replacement create for bounded_lite_plan_artifact", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-replacement-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const oldPlan = await writePlanArtifact({
        projectRoot: process.cwd(),
        configDir,
        action: "write",
        operation: "create",
        title: "Old",
        markdown: "# Old",
        systemIdentity: {
          sessionKey: "20260518-1130-z9y8x7w6",
          sessionStartedAt: "2026-05-18T03:30:00Z",
          planId: "a1b2c3d4",
        },
        filenameHint: "old.md",
        generatedBy: "command-lead",
      });

      const created = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "Replacement",
          markdown: "# Replacement",
          filenameHint: "replacement.md",
          generatedBy: "command-lead",
          replacesPlanRef: oldPlan.path,
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string; operation: string };

      expect(created.ok).toBe(true);
      expect(created.operation).toBe("create");
      expect(created.path).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}\/replacement\.md$/);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects partial provenance create input for bounded_lite_plan_artifact", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });

    const output = await execPlanArtifact(
      hooks,
      {
        action: "write",
        operation: "create",
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        generatedBy: "command-lead",
        sourceSessionKey: "20260518-1130-z9y8x7w6",
      },
      { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    expect(output.ok).toBe(false);
    expect(output.code).toBe("PLANART_ERR_SOURCE_PLAN_REF_REQUIRED");
  });

  it("rejects missing update payload and cross-session target for bounded_lite_plan_artifact", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });

    const missingPayload = await execPlanArtifact(
      hooks,
        {
          action: "write",
          operation: "update",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    const crossSession = await execPlanArtifact(
      hooks,
        {
          action: "write",
          operation: "update",
          targetPlanRef: "20260518-1130-z9y8x7w6/plan.md",
          markdown: "# x",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    const updateWithSource = await execPlanArtifact(
      hooks,
        {
          action: "write",
          operation: "update",
          markdown: "# x",
          sourcePlanRef: "20260518-1130-z9y8x7w6/plan.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    const updateWithReplacement = await execPlanArtifact(
      hooks,
        {
          action: "write",
          operation: "update",
          markdown: "# x",
          replacesPlanRef: "20260518-1130-z9y8x7w6/plan.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
    ) as { ok: boolean; code: string; message: string };

    expect(missingPayload.ok).toBe(false);
    expect(missingPayload.code).toBe("PLANART_ERR_MISSING_UPDATE_PAYLOAD");
    expect(crossSession.ok).toBe(false);
    expect(crossSession.code).toBe("PLANART_ERR_TARGET_NOT_FOUND");
    expect(updateWithSource.ok).toBe(false);
    expect(updateWithSource.code).toBe("PLANART_ERR_UPDATE_SOURCE_FORBIDDEN");
    expect(updateWithReplacement.ok).toBe(false);
    expect(updateWithReplacement.code).toBe("PLANART_ERR_UPDATE_REPLACEMENT_FORBIDDEN");
  });

  it("supports action=rebuild for bounded_lite_plan_artifact", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-rebuild-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "路由方案设计",
          markdown: "# Plan",
          filenameHint: "routing-plan.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      );

      await writeFile(path.join(configDir, "openplan", "index.jsonl"), "{broken\n");
      const rebuilt = await execPlanArtifact(
        hooks,
        { action: "rebuild", reason: "manual repair" },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        indexPath: string;
        scannedFileCount: number;
        rebuiltRecordCount: number;
        status: string;
        mode: string;
      };

      expect(rebuilt.ok).toBe(true);
      expect(rebuilt.action).toBe("rebuild");
      expect(rebuilt.indexPath).toBe("openplan/index.jsonl");
      expect(rebuilt.scannedFileCount).toBe(1);
      expect(rebuilt.rebuiltRecordCount).toBe(1);
      expect(rebuilt.mode).toBe("manual-rebuild");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("tolerates operation field for action=rebuild to stay wrapper-compatible", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-rebuild-operation-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "seed",
          markdown: "# seed",
          filenameHint: "seed.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      );

      await writeFile(path.join(configDir, "openplan", "index.jsonl"), "{broken\n");
      const rebuilt = await execPlanArtifact(
        hooks,
        { action: "rebuild", operation: "update", reason: "wrapper compatibility" },
        { directory: process.cwd() },
      ) as {
        ok: boolean;
        action: string;
        applied: boolean;
        indexPath: string;
        scannedFileCount: number;
        rebuiltRecordCount: number;
        mode: string;
      };

      expect(rebuilt.ok).toBe(true);
      expect(rebuilt.action).toBe("rebuild");
      expect(rebuilt.applied).toBe(true);
      expect(rebuilt.indexPath).toBe("openplan/index.jsonl");
      expect(rebuilt.scannedFileCount).toBe(1);
      expect(rebuilt.rebuiltRecordCount).toBe(1);
      expect(rebuilt.mode).toBe("manual-rebuild");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects write-only fields for action=rebuild", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });

    const cases: Array<{ payload: Record<string, unknown>; code: string }> = [
      { payload: { action: "rebuild", filenameHint: "a.md" }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", filenameHint: "" }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", sessionKey: "20260518-1030-a1b2c3d4" }, code: "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN" },
      { payload: { action: "rebuild", sessionStartedAt: "2026-05-18T02:30:00Z" }, code: "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN" },
      { payload: { action: "rebuild", planId: "a1b2c3d4" }, code: "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN" },
      { payload: { action: "rebuild", planId: null }, code: "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN" },
      { payload: { action: "rebuild", status: "draft" }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", status: 0 }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", maturityLevel: "M2" }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", maturityLevel: false }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", filename_hint: {} }, code: "PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN" },
      { payload: { action: "rebuild", plan_id: [] }, code: "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN" },
    ];

    for (const testCase of cases) {
      const output = await execPlanArtifact(
        hooks,
        testCase.payload,
        { directory: process.cwd() },
      ) as { ok: boolean; code: string; message: string };

      expect(output.ok).toBe(false);
      expect(output.code).toBe(testCase.code);
    }
  });

  it("self-check 恢复缺失 index 后首次 write 正常", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-selfcheck-missing-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writePlanArtifact({
        projectRoot: process.cwd(),
        configDir,
        action: "write",
        operation: "create",
        title: "seed",
        markdown: "# seed",
        systemIdentity: {
          sessionKey: "20260518-1030-a1b2c3d4",
          sessionStartedAt: "2026-05-18T02:30:00Z",
          planId: "a1b2c3d4",
        },
        filenameHint: "seed.md",
        generatedBy: "command-lead",
      });
      await rm(path.join(configDir, "openplan", "index.jsonl"), { force: true });

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const output = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "next",
          markdown: "# next",
          filenameHint: "next.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string; applied: boolean; path: string };

      expect(output.ok).toBe(true);
      expect(output.path).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}\/next\.md$/);
      const index = await readFile(path.join(configDir, "openplan", "index.jsonl"), "utf8");
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/seed.md"');
      expect(index).toContain(output.path);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("self-check 只执行一次，后续 index 损坏由 write-recovery 而非再次 self-check 处理", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-selfcheck-once-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const first = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "seed",
          markdown: "# seed",
          filenameHint: "seed.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string };

      expect(first.ok).toBe(true);
      await writeFile(path.join(configDir, "openplan", "index.jsonl"), "{broken\n");

      const second = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "after",
          markdown: "# after",
          filenameHint: "after.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; applied: boolean; rebuildTriggered: boolean };

      expect(second.ok).toBe(true);
      expect(second.applied).toBe(true);
      expect(second.rebuildTriggered).toBe(true);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("self-check 损坏 index 时首次调用自动恢复", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-selfcheck-corrupt-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await writePlanArtifact({
        projectRoot: process.cwd(),
        configDir,
        action: "write",
        operation: "create",
        title: "seed",
        markdown: "# seed",
        systemIdentity: {
          sessionKey: "20260518-1030-a1b2c3d4",
          sessionStartedAt: "2026-05-18T02:30:00Z",
          planId: "a1b2c3d4",
        },
        filenameHint: "seed.md",
        generatedBy: "command-lead",
      });
      await writeFile(path.join(configDir, "openplan", "index.jsonl"), "{broken\n");

      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });
      const output = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "next",
          markdown: "# next",
          filenameHint: "next.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; path: string };

      expect(output.ok).toBe(true);
      expect(output.path).toMatch(/^\d{8}-\d{4}-[a-z0-9]{8}\/next\.md$/);
      const index = await readFile(path.join(configDir, "openplan", "index.jsonl"), "utf8");
      expect(index).toContain(output.path);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("self-check 失败后后续 write 能看到失败状态，manual rebuild 可继续暴露修复结果", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-selfcheck-failed-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await mkdir(path.join(configDir, "openplan", "20260518-1030-a1b2c3d4"), { recursive: true });
      await writeFile(path.join(configDir, "openplan", "20260518-1030-a1b2c3d4", "bad.md"), "---\nplan_id: broken\n---\nbody\n");
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const writeAttempt = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "after",
          markdown: "# after",
          filenameHint: "after.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; code: string; message: string };

      const rebuildAttempt = await execPlanArtifact(
        hooks,
        { action: "rebuild", reason: "manual repair" },
        { directory: process.cwd() },
      ) as { ok: boolean; code: string; message: string };

      expect(writeAttempt.ok).toBe(false);
      expect(writeAttempt.message).toContain("index self-check repair failed");
      expect(rebuildAttempt.ok).toBe(false);
      expect(rebuildAttempt.message).toContain("invalid plan file");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("self-check 失败后即使修好文件，第二次调用也不会自动重试 self-check", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-planart-selfcheck-once-fail-"));
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;

    try {
      process.env.OPENCODE_CONFIG_DIR = configDir;
      await mkdir(path.join(configDir, "openplan", "20260518-1030-a1b2c3d4"), { recursive: true });
      const badPlanPath = path.join(configDir, "openplan", "20260518-1030-a1b2c3d4", "bad.md");
      await writeFile(badPlanPath, "---\nplan_id: broken\n---\nbody\n");
      const hooks = createBoundedLitePlugin({ directory: process.cwd() }, { configDir });

      const first = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "after",
          markdown: "# after",
          filenameHint: "after.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; message: string };

      expect(first.ok).toBe(false);
      await writePlanArtifact({
        projectRoot: process.cwd(),
        configDir,
        action: "write",
        operation: "create",
        title: "fixed",
        markdown: "# fixed",
        systemIdentity: {
          sessionKey: "20260518-1030-a1b2c3d4",
          sessionStartedAt: "2026-05-18T02:30:00Z",
          planId: "c1d2e3f4",
        },
        filenameHint: "fixed.md",
        generatedBy: "command-lead",
      }).catch(() => undefined);
      await rm(badPlanPath, { force: true });

      const second = await execPlanArtifact(
        hooks,
        {
          action: "write",
          operation: "create",
          title: "after-2",
          markdown: "# after-2",
          filenameHint: "after-2.md",
          generatedBy: "command-lead",
        },
        { directory: process.cwd() },
      ) as { ok: boolean; message: string };

      expect(second.ok).toBe(false);
      expect(second.message).toContain("index self-check repair failed");
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("returns unknown action validation error for invalid action", async () => {
    const hooks = createBoundedLitePlugin({ directory: process.cwd() });
    const output = await execModelConfig(
      hooks,
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
    const output = await execModelConfig(
      hooks,
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
      execModelConfig(
        hooks,
        null as unknown as Record<string, unknown>,
        { directory: process.cwd() },
      ),
      execModelConfig(
        hooks,
        "list" as unknown as Record<string, unknown>,
        { directory: process.cwd() },
      ),
      execModelConfig(
        hooks,
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

      await execModelConfig(
        hooks,
        {
          action: "apply",
          taskLeadProfileAssignments: {
            quick: "openai/gpt-5.4-mini",
          },
        },
        { directory: configDir },
      );

      const output = await execModelConfig(hooks, { action: "list" }, { directory: configDir }) as {
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
      const output = await execModelConfig(
        hooks,
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
      const output = await execModelConfig(
        hooks,
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
      const output = await execModelConfig(
        hooks,
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
      const output = await execModelConfig(
        hooks,
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

      const output = await execModelConfig(
        hooks,
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
      const output = await execModelConfig(
        hooks,
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

      const output = await execModelConfig(
        hooks,
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
      await execModelConfig(
        hooks,
        { action: "apply", assignments: { "command-lead": "openai/gpt-5.4" } },
        { directory: process.cwd() },
      );

      const second = await execModelConfig(
        hooks,
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
      const autoPreview = await execModelConfig(
        hooks,
        { action: "auto" },
        { directory: process.cwd() },
      ) as { recommendations?: { roles?: Record<string, string> } };

      expect(autoPreview.recommendations?.roles).toBeTruthy();
      const listed = await execModelConfig(
        hooks,
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
      const imported = await execModelConfig(hooks, { action: "import" }, { directory: process.cwd() }) as {
        ok: boolean;
        action: string;
      };
      expect(imported).toMatchObject({ ok: true, action: "import" });

      const autoPreview = await execModelConfig(
        hooks,
        { action: "auto" },
        { directory: process.cwd() },
      ) as { recommendations?: { roles?: Record<string, string> } };
      const roles = autoPreview.recommendations?.roles ?? {};
      expect(Object.keys(roles).length).toBeGreaterThan(0);

      const apply = await execModelConfig(
        hooks,
        { action: "apply", assignments: roles },
        { directory: process.cwd() },
      ) as { ok: boolean; action: string };
      expect(apply).toMatchObject({ ok: true, action: "apply" });

      const listed = await execModelConfig(
        hooks,
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

  it("blocks task delegation for /agent-models in tool.execute.before", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    expect(() => hooks["tool.execute.before"]?.(
      { tool: "task", args: { command: "/agent-models", prompt: "/agent-models" } },
      { args: { command: "/agent-models", prompt: "/agent-models" } },
    )).toThrow("/agent-models must be executed directly by command-lead");
  });
});
