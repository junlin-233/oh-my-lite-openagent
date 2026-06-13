import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
    expect(toolNames).toContain("bounded_lite_study_ingest");
    expect(toolNames).toContain("bounded_lite_study_package");
    expect(toolNames.every((toolName) => toolName.startsWith("bounded_lite_"))).toBe(true);
    expect(toolNames.every((toolName) => /^[a-zA-Z0-9_-]+$/.test(toolName))).toBe(true);
  });

  it("returns promises from bounded lite tools and hooks", async () => {
    const hooks = await createBoundedLitePlugin({
      directory: process.cwd(),
    });

    const routeResult = hooks.tool?.bounded_lite_route?.execute(
      { category: "execution" },
      { directory: process.cwd() },
    );
    const backgroundResult = hooks.tool?.bounded_lite_background?.execute(
      {},
      { directory: process.cwd() },
    );
    const runtimeProfileResult = hooks.tool?.bounded_lite_runtime_profile?.execute(
      {},
      { directory: process.cwd() },
    );
    const permissionResult = hooks["permission.ask"]?.(
      { tool: "bounded_lite_route", action: "execute" },
      { status: "deny" },
    );

    expect(routeResult).toBeInstanceOf(Promise);
    expect(backgroundResult).toBeInstanceOf(Promise);
    expect(runtimeProfileResult).toBeInstanceOf(Promise);
    expect(permissionResult).toBeInstanceOf(Promise);
    const routeOutput = await routeResult;
    const backgroundOutput = await backgroundResult;
    const runtimeProfileOutput = await runtimeProfileResult;

    expect(typeof routeOutput).toBe("string");
    expect(typeof backgroundOutput).toBe("string");
    expect(typeof runtimeProfileOutput).toBe("string");
    expect(JSON.parse(routeOutput as string)).toMatchObject({ targetRole: "command-lead" });
    expect(JSON.parse(backgroundOutput as string)).toEqual([]);
    expect(JSON.parse(runtimeProfileOutput as string)).toMatchObject({
      mode: "full",
      visibleModes: ["execution", "planning", "deep-planning"],
    });
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

  it("shows the imported model pool before auto recommendations", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-models-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = await createBoundedLitePlugin(
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
      );

      expect(String(output)).toContain("Available imported model pool (review before recommendations):");
      expect(String(output)).toContain("openai/gpt-5.4");
      expect(String(output).indexOf("Available imported model pool (review before recommendations):"))
        .toBeLessThan(String(output).indexOf("Oh My Lite OpenAgent auto model configuration"));
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("writes model config updates to oh-my-lite-openagent.json and generated agent markdown", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-plugin-jsonc-"));

    try {
      const jsoncPath = path.join(configDir, "opencode.jsonc");
      await writeFile(
        jsoncPath,
        `{
          // Existing JSONC config.
          "agent": {
            "command-lead": {},
          },
        }\n`,
      );
      const agentsDir = path.join(configDir, "agents");

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          reasoningEffortAssignments: { "command-lead": "max" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );
      const writtenConfigText = await readFile(jsoncPath, "utf8");
      const liteConfigPath = path.join(configDir, "oh-my-lite-openagent.json");
      const writtenLiteConfig = JSON.parse(await readFile(liteConfigPath, "utf8"));
      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");

      expect(String(output)).toContain(`Updated ${liteConfigPath}`);
      expect(writtenConfigText).not.toContain('"model": "openai/gpt-5.4"');
      expect(writtenLiteConfig.roleModels["command-lead"]).toBe("openai/gpt-5.4");
      expect(writtenLiteConfig.roleReasoningEffort["command-lead"]).toBe("max");
      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).not.toContain("reasoningEffort:");
      expect(await pathExists(path.join(configDir, "opencode.json"))).toBe(false);
      expect(await pathExists(`${liteConfigPath}.bak`)).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes generated agent reasoning effort when only model assignments are applied", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-model-only-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(jsonPath, `${JSON.stringify({ agent: { "command-lead": {} } })}\n`);
      const agentsDir = path.join(configDir, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "command-lead.md"),
        "---\nmode: primary\nreasoningEffort: high\n---\n\n# Command Lead\n",
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );

      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");
      const writtenLiteConfig = JSON.parse(await readFile(path.join(configDir, "oh-my-lite-openagent.json"), "utf8"));

      expect(writtenLiteConfig.roleModels["command-lead"]).toBe("openai/gpt-5.4");
      expect(writtenLiteConfig.roleReasoningEffort["command-lead"]).toBeUndefined();
      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).not.toContain("reasoningEffort:");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes stale generated agent reasoning effort on model-only apply", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-stale-reasoning-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(jsonPath, `${JSON.stringify({ agent: { "command-lead": {} } })}\n`);
      await writeFile(path.join(configDir, "oh-my-lite-openagent.json"), `${JSON.stringify({
        schemaVersion: 1,
        roleModels: {},
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      })}\n`);
      const agentsDir = path.join(configDir, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "command-lead.md"),
        "---\nmode: primary\nreasoningEffort: low\n---\n\n# Command Lead\n",
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );

      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");

      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).not.toContain("reasoningEffort:");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("ingests only first-level study courseware and reports generated outputs", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-"));

    try {
      await writeFile(
        path.join(coursewareDir, "01-database.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 1 Database Systems covers relational models normalization SQL transactions indexing recovery and exam review checkpoints for final preparation.) Tj ET\n%%EOF\n",
      );
      await writeFile(path.join(coursewareDir, "study-guide.md"), "generated\n");
      await mkdir(path.join(coursewareDir, "nested"));
      await writeFile(path.join(coursewareDir, "nested", "ignored.pdf"), "BT (Nested) Tj ET\n");
      await mkdir(path.join(coursewareDir, "sources"));

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.discoveredFiles).toEqual(["01-database.pdf"]);
      expect(result.ignoredGeneratedOutputs).toEqual(expect.arrayContaining(["study-guide.md", "sources/"]));
      expect(result.sources[0]).toMatchObject({
        filename: "01-database.pdf",
        extension: ".pdf",
        status: "ok",
      });
      expect(result.sources[0].extraction).toMatchObject({
        method: expect.any(String),
        quality: expect.stringMatching(/^(high|medium)$/),
        confidence: expect.any(Number),
        needsManualReview: false,
      });
      expect(result.sources[0].slides[0]).toMatchObject({
        extractionMethod: expect.any(String),
        extractionQuality: expect.stringMatching(/^(high|medium)$/),
        confidence: expect.any(Number),
        needsManualReview: false,
      });
      expect(result.sources[0].slides[0].text).toContain("Chapter 1 Database Systems");
      expect(result.chapterCandidates.some((candidate: string) => candidate.includes("Chapter 1 Database Systems"))).toBe(true);
      expect(result.policy.recursive).toBe(false);
      expect(result.policy.externalLabelRequired).toBe("[External]");
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("returns a recoverable blocker for legacy ppt when soffice is unavailable", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-ppt-"));
    const originalPath = process.env.PATH;

    try {
      process.env.PATH = "";
      await writeFile(path.join(coursewareDir, "legacy.ppt"), "legacy binary placeholder\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.sources[0]).toMatchObject({
        filename: "legacy.ppt",
        extension: ".ppt",
        status: "blocked",
      });
      expect(result.sources[0].extraction).toMatchObject({
        method: "ppt-soffice-missing",
        quality: "blocked",
        confidence: 0,
        needsManualReview: true,
      });
      expect(result.recoverableBlockers[0]).toMatchObject({
        file: "legacy.ppt",
        recoverability: "recoverable",
        requiredTool: "soffice",
      });
    } finally {
      process.env.PATH = originalPath;
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("generates a bounded current-directory study package", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-package-"));

    try {
      await writeFile(
        path.join(coursewareDir, "02-indexes.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 2 Indexes covers B plus trees hash indexes clustered indexes selectivity query planning and common final exam mistakes.) Tj ET\n%%EOF\n",
      );
      await writeFile(path.join(coursewareDir, "AGENTS.md"), "# Course rules\n\nKeep this line.\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));
      const agents = await readFile(path.join(coursewareDir, "AGENTS.md"), "utf8");
      const sourceIndex = JSON.parse(await readFile(path.join(coursewareDir, "source-index.json"), "utf8"));

      expect(result.status).toBe("ok");
      expect(result.writtenFiles).toEqual(expect.arrayContaining([
        "AGENTS.md",
        "source-index.json",
        "study-guide.md",
        "exam-points.md",
        "mindmap.md",
        "anki_flashcards.csv",
        "practice-questions.md",
        "coverage-report.md",
        "sources/02-indexes.md",
        "summaries/02-indexes.md",
      ]));
      expect(agents).toContain("Keep this line.");
      expect(agents).toContain("oh-my-lite-study:start");
      expect(sourceIndex.discoveredFiles).toEqual(["02-indexes.pdf"]);
      const summary = await readFile(path.join(coursewareDir, "summaries", "02-indexes.md"), "utf8");
      expect(summary).toContain("Manual Text Review");
      expect(summary).not.toContain("Visual Review");
      expect(summary).not.toContain("visual-heavy");
      const sourceNotes = await readFile(path.join(coursewareDir, "sources", "02-indexes.md"), "utf8");
      expect(sourceNotes).not.toContain("visual review");
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("supports a source-only study package stage before full generation", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-sources-"));

    try {
      await writeFile(
        path.join(coursewareDir, "04-transactions.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 4 Transactions covers ACID isolation schedules serializability locking logging recovery checkpoints and final exam practice.) Tj ET\n%%EOF\n",
      );

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        { stage: "sources" },
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.stage).toBe("sources");
      expect(result.writtenFiles).toEqual(expect.arrayContaining([
        "AGENTS.md",
        "source-index.json",
        "coverage-report.md",
        "sources/04-transactions.md",
      ]));
      expect(result.writtenFiles).not.toContain("study-guide.md");
      expect(result.writtenFiles).not.toContain("summaries/04-transactions.md");
      await expect(readFile(path.join(coursewareDir, "study-guide.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("blocks study package generation for invalid AGENTS markers", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-agents-"));

    try {
      await writeFile(path.join(coursewareDir, "slides.pdf"), "BT (Chapter 3 Recovery) Tj ET\n");
      await writeFile(path.join(coursewareDir, "AGENTS.md"), "<!-- oh-my-lite-study:start -->\nmissing end\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.status).toBe("blocked");
      expect(result.recoverableBlockers[0]).toMatchObject({
        file: "AGENTS.md",
        recoverability: "recoverable",
      });
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("requires explicit authorization for study tools outside the current directory", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-base-"));
    const externalDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-external-"));

    try {
      await writeFile(path.join(externalDir, "external.pdf"), "BT (External) Tj ET\n");
      const hooks = await createBoundedLitePlugin({ directory: baseDir });

      await expect(hooks.tool?.bounded_lite_study_ingest?.execute(
        { directory: externalDir },
        { directory: baseDir },
      )).rejects.toThrow("allowExternalDirectory=true");

      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        { directory: externalDir, allowExternalDirectory: true },
        { directory: baseDir },
      );
      const result = JSON.parse(String(output));

      expect(result.discoveredFiles).toEqual(["external.pdf"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
      await rm(externalDir, { recursive: true, force: true });
    }
  });
});
