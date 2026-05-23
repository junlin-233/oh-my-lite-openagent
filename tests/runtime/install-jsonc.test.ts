import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

      expect(output).toContain(`OpenCode config: ${jsoncPath}`);
      expect(await pathExists(path.join(configDir, "opencode.json"))).toBe(false);
      expect(writtenConfig.provider.openai.models["gpt-5.4"].name).toBe("GPT-5.4");
      expect(writtenConfig.plugin).toContain("./custom-plugin.ts");
      expect(writtenConfig.agent["custom-agent"].model).toBe("openai/gpt-5.4");
      expect(writtenConfig.agent["command-lead"]).toBeTruthy();
      expect(await pathExists(`${jsoncPath}.bak`)).toBe(true);
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
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
