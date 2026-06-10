import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runInstaller(configDir: string): Promise<string> {
  const result = await execFileAsync(
    process.execPath,
    [path.resolve(process.cwd(), "scripts/install.mjs"), "--config-dir", configDir],
    { cwd: process.cwd() },
  );
  return result.stdout;
}

async function runInstallerWithArgs(configDir: string, extraArgs: string[]): Promise<string> {
  const result = await execFileAsync(
    process.execPath,
    [path.resolve(process.cwd(), "scripts/install.mjs"), "--config-dir", configDir, ...extraArgs],
    { cwd: process.cwd() },
  );
  return result.stdout;
}

describe("global installer JSONC config handling", () => {
  it("merges into an existing opencode.jsonc instead of silently creating opencode.json", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-jsonc-"));

    try {
      const jsoncPath = path.join(configDir, "opencode.jsonc");
      await writeFile(
        jsoncPath,
        `{
          // Existing user provider config must survive.
          "provider": {
            "openai": {
              "models": {
                "gpt-5.4": { "name": "GPT-5.4" },
              },
            },
          },
          "plugin": ["./custom-plugin.ts"],
          "agent": {
            "custom-agent": { "model": "openai/gpt-5.4" },
          },
        }\n`,
      );

      const output = await runInstaller(configDir);
      const writtenConfig = JSON.parse(await readFile(jsoncPath, "utf8"));
      const liteConfig = JSON.parse(await readFile(path.join(configDir, "oh-my-lite-openagent.json"), "utf8"));
      const generatedCommandLead = await readFile(path.join(configDir, "agents", "command-lead.md"), "utf8");

      expect(output).toContain(`OpenCode config: ${jsoncPath}`);
      expect(output).toContain(`Oh My Lite config: ${path.join(configDir, "oh-my-lite-openagent.json")}`);
      expect(await pathExists(path.join(configDir, "opencode.json"))).toBe(false);
      expect(writtenConfig.provider.openai.models["gpt-5.4"].name).toBe("GPT-5.4");
      expect(writtenConfig.mcp.context7.command).toEqual(["npx", "-y", "@upstash/context7-mcp"]);
      expect(writtenConfig.mcp.playwright.command).toEqual(["npx", "-y", "@playwright/mcp"]);
      expect(writtenConfig.plugin).toContain("./custom-plugin.ts");
      expect(writtenConfig.agent["custom-agent"].model).toBe("openai/gpt-5.4");
      expect(writtenConfig.agent["command-lead"]).toBeUndefined();
      expect(liteConfig.schemaVersion).toBe(1);
      expect(generatedCommandLead).toContain("mode: primary");
      expect(await pathExists(`${jsoncPath}.bak`)).toBe(true);
      expect(await pathExists(path.join(configDir, "oh-my-lite-openagent.json.bak"))).toBe(false);
      expect(await pathExists(path.join(configDir, "agents", "command-lead.md.bak"))).toBe(false);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("creates backups only for files that already exist", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-backup-existing-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      const agentPath = path.join(configDir, "agents", "command-lead.md");
      await writeFile(jsonPath, `{ "provider": { "openai": {} } }\n`);
      await writeFile(agentPath, "---\nmode: primary\n---\nold\n", { flag: "wx" }).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(agentPath), { recursive: true }));
        await writeFile(agentPath, "---\nmode: primary\n---\nold\n");
      });

      await runInstaller(configDir);

      expect(await pathExists(`${jsonPath}.bak`)).toBe(true);
      expect(await readFile(`${agentPath}.bak`, "utf8")).toContain("old");
      expect(await pathExists(path.join(configDir, "oh-my-lite-openagent.json.bak"))).toBe(false);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes stale managed agents from existing opencode.json", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-agent-cleanup-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(
        jsonPath,
        `${JSON.stringify({
          agent: {
            "command-lead": { mode: "primary", permission: { bash: { "*": "allow" } } },
            "custom-agent": { model: "openai/gpt-5.4" },
          },
        })}\n`,
      );

      await runInstaller(configDir);
      const writtenConfig = JSON.parse(await readFile(jsonPath, "utf8"));

      expect(writtenConfig.agent).toEqual({
        "custom-agent": { model: "openai/gpt-5.4" },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes generated agent reasoning effort over stale lite config", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-install-reasoning-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      const litePath = path.join(configDir, "oh-my-lite-openagent.json");
      const agentPath = path.join(configDir, "agents", "command-lead.md");
      await writeFile(jsonPath, `${JSON.stringify({ provider: { openai: {} } })}\n`);
      await writeFile(litePath, `${JSON.stringify({
        schemaVersion: 1,
        roleModels: {},
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      })}\n`);
      await mkdir(path.dirname(agentPath), { recursive: true });
      await writeFile(agentPath, "---\nmode: primary\nreasoningEffort: low\n---\n\n# Command Lead\n");

      await runInstaller(configDir);
      const generatedCommandLead = await readFile(agentPath, "utf8");

      expect(generatedCommandLead).not.toContain("reasoningEffort:");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("preserves existing permissions while backfilling the managed bash policy", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-permission-bash-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(
        jsonPath,
        `${JSON.stringify({
          permission: {
            edit: { "*": "allow", "**/custom-secret": "ask" },
          },
        })}\n`,
      );

      await runInstaller(configDir);
      const writtenConfig = JSON.parse(await readFile(jsonPath, "utf8"));

      expect(writtenConfig.permission.edit).toEqual({ "*": "allow", "**/custom-secret": "ask" });
      expect(writtenConfig.permission.bash).toBeTruthy();
      expect(writtenConfig.permission.bash["*"]).toBe("allow");
      expect(writtenConfig.permission.bash["sudo *"]).toBe("ask");
      expect(Object.keys(writtenConfig.permission.bash).indexOf("*")).toBeLessThan(
        Object.keys(writtenConfig.permission.bash).indexOf("sudo *"),
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("preserves user MCP servers and user overrides for managed MCP names", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-mcp-merge-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(
        jsonPath,
        `${JSON.stringify({
          mcp: {
            context7: { type: "local", command: ["custom-context7"] },
            customSearch: { type: "local", command: ["custom-search"] },
          },
        })}\n`,
      );

      await runInstaller(configDir);
      const writtenConfig = JSON.parse(await readFile(jsonPath, "utf8"));

      expect(writtenConfig.mcp.context7.command).toEqual(["custom-context7"]);
      expect(writtenConfig.mcp.customSearch.command).toEqual(["custom-search"]);
      expect(writtenConfig.mcp.playwright.command).toEqual(["npx", "-y", "@playwright/mcp"]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("can skip managed MCP defaults on request", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-no-mcp-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(jsonPath, `${JSON.stringify({ provider: { openai: {} } })}\n`);

      await runInstallerWithArgs(configDir, ["--no-managed-mcp"]);
      const writtenConfig = JSON.parse(await readFile(jsonPath, "utf8"));

      expect(writtenConfig.mcp).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("prefers opencode.json when json and jsonc both exist", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-json-first-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      const jsoncPath = path.join(configDir, "opencode.jsonc");
      await writeFile(jsonPath, `${JSON.stringify({ provider: { openai: {} } })}\n`);
      await writeFile(jsoncPath, `{ "provider": { "anthropic": {} } }\n`);

      const output = await runInstaller(configDir);
      const writtenJson = JSON.parse(await readFile(jsonPath, "utf8"));
      const untouchedJsonc = await readFile(jsoncPath, "utf8");

      expect(output).toContain(`OpenCode config: ${jsonPath}`);
      expect(writtenJson.provider.openai).toBeTruthy();
      expect(writtenJson.provider.anthropic).toBeUndefined();
      expect(untouchedJsonc).toBe(`{ "provider": { "anthropic": {} } }\n`);
      expect(await pathExists(path.join(configDir, "oh-my-lite-openagent.json"))).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
