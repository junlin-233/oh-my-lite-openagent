import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      expect(generatedAgent).toContain("reasoningEffort: high");
      expect(await pathExists(path.join(configDir, "opencode.json"))).toBe(false);
      expect(await pathExists(`${liteConfigPath}.bak`)).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
