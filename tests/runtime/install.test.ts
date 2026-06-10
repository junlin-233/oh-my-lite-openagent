import { readFileSync } from "node:fs";
import path from "node:path";

const installScript = readFileSync(path.resolve(process.cwd(), "scripts/install.mjs"), "utf8");

describe("global installer contract", () => {
  it("does not treat old legacy role names as managed agents", () => {
    const managedAgentBlock = installScript.match(
      /const OUR_ROLE_NAMES = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1] ?? "";

    expect(managedAgentBlock).not.toContain('"review"');
    expect(managedAgentBlock).not.toContain('"power-plan-builder"');
    expect(managedAgentBlock).toContain('"plan-review"');
    expect(managedAgentBlock).toContain('"result-review"');
  });

  it("removes old managed command names during config merge", () => {
    expect(installScript).toContain("const MANAGED_COMMAND_NAMES = new Set");
    expect(installScript).toContain('"agent-models"');
    expect(installScript).toContain('"Character-model"');
    expect(installScript).toContain("!MANAGED_COMMAND_NAMES.has(commandName)");
  });

  it("tracks managed MCP names separately from user MCP servers", () => {
    expect(installScript).toContain("const MANAGED_MCP_NAMES = new Set");
    expect(installScript).toContain('"context7"');
    expect(installScript).toContain('"playwright"');
    expect(installScript).toContain("function mergeMcp(existingMcp, sourceMcp, managedMcp = true)");
    expect(installScript).toContain("MANAGED_MCP_NAMES.has(serverName)");
    expect(installScript).toContain("--no-managed-mcp");
  });

  it("writes the target configDir into the managed plugin options", () => {
    expect(installScript).toContain("function relativePluginSpec(configDir, taskLeadProfiles)");
    expect(installScript).toContain("configDir,");
    expect(installScript).toContain("relativePluginSpec(configDir, taskLeadProfiles)");
  });

  it("migrates legacy top-level Task Lead profiles into plugin options", () => {
    expect(installScript).toContain("existingConfig.taskLeadProfiles");
    expect(installScript).toContain("managedPluginOptions.taskLeadProfiles");
    expect(installScript).toContain("existingWithoutLegacyProfiles");
    expect(installScript).toContain("taskLeadProfiles } : {})");
  });

  it("keeps model provider source classification in the installer", () => {
    expect(installScript).toContain("function classifyModelProvider(provider)");
    expect(installScript).toContain('"opencode-subscription"');
    expect(installScript).toContain('"api-provider"');
    expect(installScript).toContain('"gateway"');
    expect(installScript).not.toContain('["opencode", "opencode-go", "fish"]');
  });

  it("names built-in disabled overrides separately from real roles", () => {
    expect(installScript).toContain("const BUILTIN_AGENT_OVERRIDES = new Set");
    expect(installScript).toContain("const OUR_ROLE_NAMES = new Set");
    expect(installScript).toContain("new Set([...BUILTIN_AGENT_OVERRIDES, ...OUR_ROLE_NAMES])");
  });

  it("keeps the installer JSONC parser synchronized with the runtime JSONC helper", () => {
    expect(installScript).toContain("keep in sync with .opencode/lib/runtime/jsonc.ts");
    expect(installScript).toContain("function stripJsonComments(content)");
    expect(installScript).toContain("function stripTrailingCommas(content)");
    expect(installScript).toContain("function parseJsonConfig(content)");
  });

  it("keeps install flow split into named steps", () => {
    expect(installScript).toContain("async function prepareInstallContext(options)");
    expect(installScript).toContain("function mergeAll(context)");
    expect(installScript).toContain("async function runInteractiveSetup(liteConfig, context)");
    expect(installScript).toContain("async function writeOutputs(context, mergedConfig, liteConfig)");
  });
});
