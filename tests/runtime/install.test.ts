import { readFileSync } from "node:fs";
import path from "node:path";

const installScript = readFileSync(path.resolve(process.cwd(), "scripts/install.mjs"), "utf8");

describe("global installer contract", () => {
  it("does not treat old legacy role names as managed agents", () => {
    const managedAgentBlock = installScript.match(
      /const MANAGED_AGENT_NAMES = new Set\(\[([\s\S]*?)\]\);/,
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
});
