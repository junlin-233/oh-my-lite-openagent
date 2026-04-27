#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_FILE = "bounded-lite.ts";
const MANAGED_DIRS = ["agents", "plugins", "lib"];
const DEFAULT_PLUGIN_OPTIONS = { mode: "full" };
const MANAGED_COMMAND_NAMES = new Set([
  "agent-models",
  "Character-model",
]);
const MANAGED_AGENT_NAMES = new Set([
  "build",
  "plan",
  "command-lead",
  "plan-builder",
  "deep-plan-builder",
  "task-lead",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
]);

// ---------------------------------------------------------------------------
// Role model recommendation data (mirror of role-model-recommendations.ts)
// ---------------------------------------------------------------------------

const ROLE_MODEL_PROFILES = [
  {
    role: "command-lead",
    capability: "orchestration",
    description: "Main orchestrator — needs strongest reasoning",
    recommendations: [
      "claude-opus",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "kimi-k2",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
      "gpt-5-nano",
    ],
  },
  {
    role: "plan-builder",
    capability: "planning",
    description: "Visible planner — needs strong reasoning",
    recommendations: [
      "claude-opus",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "kimi-k2",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "deep-plan-builder",
    capability: "advisory-planning",
    description: "Deep planner — produces detailed plans for lower-strength executors",
    recommendations: [
      "claude-sonnet",
      "kimi-k2",
      "gemini-3-flash",
      "gpt-5.4",
      "claude-opus",
      "gpt-4o",
      "gpt-5.3-codex",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "task-lead",
    capability: "execution",
    description: "Bounded task executor — mid-tier models sufficient",
    recommendations: [
      "claude-sonnet",
      "kimi-k2",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "gpt-4o",
      "gpt-5.3-codex",
      "minimax-m2",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "explore",
    capability: "fast-retrieval",
    description: "Read-only code exploration — fast, cheap models preferred",
    recommendations: [
      "gpt-5.4-mini",
      "claude-haiku",
      "minimax-m2.7-highspeed",
      "minimax-m2",
      "gemini-2.0-flash",
      "gemini-3-flash",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "librarian",
    capability: "fast-retrieval",
    description: "External research — fast, cheap models preferred",
    recommendations: [
      "gpt-5.4-mini",
      "claude-haiku",
      "minimax-m2.7-highspeed",
      "minimax-m2",
      "gemini-2.0-flash",
      "gemini-3-flash",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "plan-review",
    capability: "critical-review",
    description: "Plan review — needs strongest reasoning to catch errors",
    recommendations: [
      "gpt-5.4",
      "claude-opus",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "result-review",
    capability: "critical-review",
    description: "Result review — needs strongest reasoning to verify completeness",
    recommendations: [
      "gpt-5.4",
      "claude-opus",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
];

// ---------------------------------------------------------------------------
// Provider question definitions
// ---------------------------------------------------------------------------

const PROVIDER_QUESTIONS = [
  {
    key: "hasClaude",
    label: "Anthropic (Claude)",
    hint: "Claude Opus/Sonnet/Haiku for orchestration, planning, and review",
  },
  {
    key: "hasOpenAI",
    label: "OpenAI (ChatGPT)",
    hint: "GPT-5.4/o3 for strong reasoning and review",
  },
  {
    key: "hasGemini",
    label: "Google (Gemini)",
    hint: "Gemini Pro for planning and multimodal tasks",
  },
  {
    key: "hasCopilot",
    label: "GitHub Copilot",
    hint: "Copilot models as fallback option",
  },
  {
    key: "hasOpenCodeZen",
    label: "OpenCode Zen (opencode/ models)",
    hint: "opencode/ hosted models including Claude, GPT, etc.",
  },
  {
    key: "hasOpenCodeGo",
    label: "OpenCode Go (opencode-go/ models)",
    hint: "opencode-go/ models like Kimi K2 and MiniMax",
  },
  {
    key: "hasKimiCoding",
    label: "Kimi For Coding (kimi-for-coding)",
    hint: "Kimi K2.5 for task execution",
  },
  {
    key: "hasVercelGateway",
    label: "Vercel AI Gateway",
    hint: "Universal proxy for OpenAI, Anthropic, Google, etc.",
  },
];

// ---------------------------------------------------------------------------
// Model mapping: provider availability → primary model per role
// ---------------------------------------------------------------------------

function matchesPattern(modelId, pattern) {
  return modelId.toLowerCase().includes(pattern.toLowerCase());
}

function classifyModelProvider(provider) {
  const normalized = provider.toLowerCase();

  if (["opencode", "opencode-go"].includes(normalized)) {
    return "opencode-subscription";
  }

  if (["openai", "anthropic", "google", "github-copilot", "kimi-for-coding"].includes(normalized)) {
    return "api-provider";
  }

  if (normalized === "vercel") {
    return "gateway";
  }

  return "unknown";
}

function resolveModelsForProviders(availableModels) {
  const assignments = {};
  const resolved = [];
  const unresolved = [];

  for (const profile of ROLE_MODEL_PROFILES) {
    let bestModel = undefined;
    let bestModelSource = undefined;
    let matchedPattern = undefined;

    for (const pattern of profile.recommendations) {
      const matched = availableModels.find((model) => matchesPattern(model.id, pattern));
      if (matched) {
        bestModel = matched.id;
        bestModelSource = matched.source;
        matchedPattern = pattern;
        break;
      }
    }

    if (bestModel) {
      assignments[profile.role] = bestModel;
      resolved.push({ role: profile.role, model: bestModel, source: bestModelSource, matchedPattern });
    } else {
      unresolved.push({ role: profile.role, capability: profile.capability });
    }
  }

  return { assignments, resolved, unresolved };
}

function collectModelsFromProviders(providerAnswers) {
  const models = [];

  if (providerAnswers.hasClaude) {
    models.push(
      { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
      { provider: "anthropic", model: "claude-sonnet-4-6", id: "anthropic/claude-sonnet-4-6" },
      { provider: "anthropic", model: "claude-haiku-4-5", id: "anthropic/claude-haiku-4-5" },
    );
  }

  if (providerAnswers.hasOpenAI) {
    models.push(
      { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      { provider: "openai", model: "gpt-5.4-mini", id: "openai/gpt-5.4-mini" },
      { provider: "openai", model: "gpt-5.3-codex", id: "openai/gpt-5.3-codex" },
      { provider: "openai", model: "gpt-4o", id: "openai/gpt-4o" },
      { provider: "openai", model: "gpt-5-nano", id: "openai/gpt-5-nano" },
    );
  }

  if (providerAnswers.hasGemini) {
    models.push(
      { provider: "google", model: "gemini-2.5-pro", id: "google/gemini-2.5-pro" },
      { provider: "google", model: "gemini-3.1-pro", id: "google/gemini-3.1-pro" },
      { provider: "google", model: "gemini-2.0-flash", id: "google/gemini-2.0-flash" },
      { provider: "google", model: "gemini-3-flash", id: "google/gemini-3-flash" },
    );
  }

  if (providerAnswers.hasCopilot) {
    models.push(
      { provider: "github-copilot", model: "gpt-5.4", id: "github-copilot/gpt-5.4" },
      { provider: "github-copilot", model: "claude-sonnet-4-6", id: "github-copilot/claude-sonnet-4-6" },
    );
  }

  if (providerAnswers.hasOpenCodeZen) {
    models.push(
      { provider: "opencode", model: "claude-opus-4-7", id: "opencode/claude-opus-4-7" },
      { provider: "opencode", model: "claude-sonnet-4-6", id: "opencode/claude-sonnet-4-6" },
      { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
      { provider: "opencode", model: "big-pickle", id: "opencode/big-pickle" },
      { provider: "opencode", model: "kimi-k2.5", id: "opencode/kimi-k2.5" },
    );
  }

  if (providerAnswers.hasOpenCodeGo) {
    models.push(
      { provider: "opencode-go", model: "kimi-k2.5", id: "opencode-go/kimi-k2.5" },
      { provider: "opencode-go", model: "minimax-m2.7", id: "opencode-go/minimax-m2.7" },
      { provider: "opencode-go", model: "minimax-m2.7-highspeed", id: "opencode-go/minimax-m2.7-highspeed" },
      { provider: "opencode-go", model: "glm-5", id: "opencode-go/glm-5" },
    );
  }

  if (providerAnswers.hasKimiCoding) {
    models.push(
      { provider: "kimi-for-coding", model: "k2p5", id: "kimi-for-coding/k2p5" },
    );
  }

  if (providerAnswers.hasVercelGateway) {
    models.push(
      { provider: "vercel", model: "claude-opus-4-7", id: "vercel/anthropic/claude-opus-4-7" },
      { provider: "vercel", model: "gpt-5.4", id: "vercel/openai/gpt-5.4" },
      { provider: "vercel", model: "gemini-2.5-pro", id: "vercel/google/gemini-2.5-pro" },
    );
  }

  return models.map((model) => ({
    ...model,
    source: classifyModelProvider(model.provider),
  }));
}

// ---------------------------------------------------------------------------
// Interactive prompt helpers
// ---------------------------------------------------------------------------

async function promptYesNo(question, defaultValue = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const defaultHint = defaultValue ? "Y/n" : "y/N";

  return new Promise((resolve) => {
    rl.question(`${question} (${defaultHint}): `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") {
        resolve(defaultValue);
      } else if (trimmed === "y" || trimmed === "yes" || trimmed === "是") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function promptProviders() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Non-interactive mode detected. Skipping model provider setup.");
    console.log("Use '/agent-models' with action=auto after installation to configure models.");
    return null;
  }

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          Oh My Lite OpenAgent — Model Provider Setup          ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log("║                                                              ║");
  console.log("║  Which AI model providers do you have access to?             ║");
  console.log("║  This will be used to pick the best model for each role.     ║");
  console.log("║                                                              ║");
  console.log("║  You can always change models later using                    ║");
  console.log("║  the /agent-models command in OpenCode.                      ║");
  console.log("║                                                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");

  const answers = {};

  for (const question of PROVIDER_QUESTIONS) {
    const result = await promptYesNo(
      `  Do you have access to ${question.label}? — ${question.hint}`,
    );
    answers[question.key] = result;
  }

  console.log("");
  return answers;
}

function formatModelAssignments(result) {
  const lines = [];

  lines.push("");
  lines.push("  Recommended model assignments:");
  lines.push("");

  for (const item of result.resolved) {
    const profile = ROLE_MODEL_PROFILES.find((p) => p.role === item.role);
    const tag = profile ? `[${profile.capability}]` : "";
    const source = item.source ? `[${item.source}]` : "";
    lines.push(`    ✓ ${item.role.padEnd(20)} → ${item.model.padEnd(35)} ${tag} ${source}`);
  }

  if (result.unresolved.length > 0) {
    lines.push("");
    lines.push("  Unresolved roles (no matching model found):");
    for (const item of result.unresolved) {
      lines.push(`    ✗ ${item.role.padEnd(20)} needs ${item.capability}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    configDir: process.env.OPENCODE_CONFIG_DIR,
    dryRun: false,
    interactive: false,
    rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--interactive") {
      args.interactive = true;
      continue;
    }

    if (arg === "--config-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--config-dir requires a path");
      args.configDir = value;
      index += 1;
      continue;
    }

    if (arg === "--root-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root-dir requires a path");
      args.rootDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function defaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "opencode");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

async function copyDir(sourceDir, targetDir, dryRun) {
  if (dryRun) return;

  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const info = await stat(sourcePath);

    if (info.isDirectory()) {
      await copyDir(sourcePath, targetPath, dryRun);
      continue;
    }

    if (info.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

function isManagedPluginSpec(spec) {
  const value = Array.isArray(spec) ? spec[0] : spec;
  return typeof value === "string" && value.includes(PLUGIN_FILE);
}

function relativePluginSpec(configDir, taskLeadProfiles) {
  return [
    "./.opencode/plugins/bounded-lite.ts",
    {
      ...DEFAULT_PLUGIN_OPTIONS,
      configDir,
      ...(isRecord(taskLeadProfiles) ? { taskLeadProfiles } : {}),
    },
  ];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeManagedAgent(sourceAgent, existingAgent) {
  if (!isRecord(sourceAgent)) return sourceAgent;
  if (!isRecord(existingAgent)) return sourceAgent;

  return {
    ...sourceAgent,
    ...(typeof existingAgent.model === "string" ? { model: existingAgent.model } : {}),
  };
}

function readManagedPluginOptions(config) {
  const plugins = Array.isArray(config.plugin)
    ? config.plugin
    : config.plugin
      ? [config.plugin]
      : [];

  for (const spec of plugins) {
    if (!isManagedPluginSpec(spec)) continue;
    if (Array.isArray(spec) && isRecord(spec[1])) return spec[1];
  }

  return {};
}

function mergeConfig(existingConfig, sourceConfig, configDir) {
  const legacyTaskLeadProfiles = isRecord(existingConfig.taskLeadProfiles)
    ? existingConfig.taskLeadProfiles
    : undefined;
  const managedPluginOptions = readManagedPluginOptions(existingConfig);
  const pluginTaskLeadProfiles = isRecord(managedPluginOptions.taskLeadProfiles)
    ? managedPluginOptions.taskLeadProfiles
    : undefined;
  const taskLeadProfiles = pluginTaskLeadProfiles ?? legacyTaskLeadProfiles;
  const { taskLeadProfiles: _legacyTaskLeadProfiles, ...existingWithoutLegacyProfiles } = existingConfig;
  const existingPlugins = Array.isArray(existingConfig.plugin)
    ? existingConfig.plugin
    : existingConfig.plugin
      ? [existingConfig.plugin]
      : [];

  const plugins = [
    ...existingPlugins.filter((spec) => !isManagedPluginSpec(spec)),
    relativePluginSpec(configDir, taskLeadProfiles),
  ];
  const existingAgents = isRecord(existingConfig.agent) ? existingConfig.agent : {};
  const sourceAgents = isRecord(sourceConfig.agent) ? sourceConfig.agent : {};
  const managedAgents = Object.fromEntries(
    Object.entries(sourceAgents).map(([agentName, sourceAgent]) => [
      agentName,
      mergeManagedAgent(sourceAgent, existingAgents[agentName]),
    ]),
  );
  const customAgents = Object.fromEntries(
    Object.entries(existingConfig.agent ?? {}).filter(([agentName]) => (
      !MANAGED_AGENT_NAMES.has(agentName)
    )),
  );

  return {
    ...existingWithoutLegacyProfiles,
    $schema: existingConfig.$schema ?? sourceConfig.$schema,
    plugin: plugins,
    default_agent: sourceConfig.default_agent,
    permission: existingConfig.permission ?? sourceConfig.permission,
    command: {
      ...Object.fromEntries(
        Object.entries(existingConfig.command ?? {}).filter(([commandName]) => (
          !MANAGED_COMMAND_NAMES.has(commandName)
        )),
      ),
      ...(sourceConfig.command ?? {}),
    },
    agent: {
      ...managedAgents,
      ...customAgents,
    },
  };
}

function applyModelAssignments(config, assignments) {
  const agents = isRecord(config.agent) ? config.agent : {};

  for (const [role, model] of Object.entries(assignments)) {
    if (typeof model !== "string" || !MANAGED_AGENT_NAMES.has(role)) continue;
    if (!isRecord(agents[role])) {
      agents[role] = { ...(isRecord(agents[role]) ? agents[role] : {}), model };
    } else {
      agents[role].model = model;
    }
  }

  config.agent = agents;
  return config;
}

async function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(`${filePath}.bak`, `${JSON.stringify(await readJsonIfExists(filePath), null, 2)}\n`);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function install(options = {}) {
  const rootDir = path.resolve(
    options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const configDir = path.resolve(options.configDir ?? defaultConfigDir());
  const dryRun = Boolean(options.dryRun);
  const interactive = Boolean(options.interactive);
  const sourceConfig = await readJsonIfExists(path.join(rootDir, "opencode.json"));
  const targetConfigPath = path.join(configDir, "opencode.json");
  const existingConfig = await readJsonIfExists(targetConfigPath);
  let mergedConfig = mergeConfig(existingConfig, sourceConfig, configDir);
  const sourceOpenCodeDir = path.join(rootDir, ".opencode");
  const targetOpenCodeDir = path.join(configDir, ".opencode");

  for (const managedDir of MANAGED_DIRS) {
    await copyDir(
      path.join(sourceOpenCodeDir, managedDir),
      path.join(targetOpenCodeDir, managedDir),
      dryRun,
    );
  }

  // Interactive model configuration
  if (interactive) {
    const providerAnswers = await promptProviders();

    if (providerAnswers) {
      const availableModels = collectModelsFromProviders(providerAnswers);
      const result = resolveModelsForProviders(availableModels);

      console.log(formatModelAssignments(result));

      if (Object.keys(result.assignments).length > 0) {
        mergedConfig = applyModelAssignments(mergedConfig, result.assignments);

        if (!dryRun) {
          console.log("  Model assignments will be written to the OpenCode config.");
        } else {
          console.log("  [Dry run] Model assignments would be written to the OpenCode config.");
        }
      }

      if (result.unresolved.length > 0) {
        console.log("  Some roles could not be matched. Consider adding more providers.");
        console.log("  You can use '/agent-models' in OpenCode to configure them manually.");
      }
    }
  }

  await writeJson(targetConfigPath, mergedConfig, dryRun);

  return {
    configDir,
    configPath: targetConfigPath,
    plugin: pathToFileURL(path.join(targetOpenCodeDir, "plugins", PLUGIN_FILE)).href,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await install(args);

  console.log(`OpenCode config: ${result.configPath}`);
  console.log(`Bounded lite plugin: ${result.plugin}`);

  if (args.interactive) {
    console.log(result.dryRun ? "Dry run with model setup complete; no files were written." : "Install with model setup complete.");
    console.log("");
    console.log("You can reconfigure models anytime using the /agent-models command in OpenCode.");
    console.log("Use action=auto for automatic configuration, action=list to view current settings,");
    console.log("or action=apply for manual per-role assignment.");
  } else {
    console.log(result.dryRun ? "Dry run complete; no files were written." : "Install complete.");
    console.log("");
    console.log("To configure models for each role, run:");
    console.log("  node scripts/install.mjs --interactive");
    console.log("Or use the /agent-models command in OpenCode.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
