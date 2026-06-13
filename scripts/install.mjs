#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfigDir } from "./install-paths.mjs";
import { MANAGED_CONFIG } from "./managed-config.mjs";

const PLUGIN_FILE = "bounded-lite.ts";
const MANAGED_DIRS = ["agents", "plugins", "lib"];
const LITE_CONFIG_FILE = "oh-my-lite-openagent.json";
const DEFAULT_PLUGIN_OPTIONS = { mode: "full" };
const MANAGED_COMMAND_NAMES = new Set([
  "agent-models",
  "go",
  "study",
  "Character-model",
]);
const MANAGED_MCP_NAMES = new Set([
  "context7",
  "playwright",
]);
const BUILTIN_AGENT_OVERRIDES = new Set([
  "build",
  "plan",
]);
const OUR_ROLE_NAMES = new Set([
  "command-lead",
  "plan-builder",
  "deep-plan-builder",
  "task-lead",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
]);
const MANAGED_AGENT_NAMES = new Set([...BUILTIN_AGENT_OVERRIDES, ...OUR_ROLE_NAMES]);

// ---------------------------------------------------------------------------
// Role model recommendation data (mirror of role-model-recommendations.ts)
// ---------------------------------------------------------------------------

export const ROLE_MODEL_PROFILES = [
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
  let cliConfigDir = undefined;
  const args = {
    configDir: undefined,
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

    if (arg === "--no-managed-mcp") {
      args.managedMcp = false;
      continue;
    }

    if (arg === "--config-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--config-dir requires a path");
      cliConfigDir = value;
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

  args.configDir = process.env.OPENCODE_CONFIG_DIR ?? cliConfigDir;
  return args;
}

export { defaultConfigDir };

async function readJsonIfExists(filePath) {
  try {
    return parseJsonConfig(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Failed to read JSON/JSONC ${filePath}: ${error.message}`);
  }
}

function stripJsonComments(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        output += content[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(content[lookahead] ?? "")) lookahead += 1;
      if (content[lookahead] === "}" || content[lookahead] === "]") continue;
    }

    output += char;
  }

  return output;
}

function parseJsonConfig(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  return JSON.parse(stripTrailingCommas(stripJsonComments(content.replace(/^\uFEFF/, ""))));
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveTargetConfigPath(configDir) {
  const jsonPath = path.join(configDir, "opencode.json");
  const jsoncPath = path.join(configDir, "opencode.jsonc");

  if (await fileExists(jsonPath)) return jsonPath;
  if (await fileExists(jsoncPath)) return jsoncPath;
  return jsonPath;
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
  if (!isRecord(existingAgent)) return { ...sourceAgent };

  return {
    ...sourceAgent,
    ...(typeof existingAgent.model === "string" ? { model: existingAgent.model } : {}),
  };
}

function createDefaultLiteConfig() {
  return {
    schemaVersion: 1,
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
    },
  };
}

function normalizeReasoningEffort(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "none") return "minimal";
  if (["minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (normalized === "med") return "medium";
  if (["x-high", "extra-high", "extra_high", "very-high", "very_high"].includes(normalized)) return "xhigh";
  if (normalized === "maximum") return "max";
  return undefined;
}

function mergeLiteConfig(existingLiteConfig, existingOpenCodeConfig) {
  const liteConfig = {
    ...createDefaultLiteConfig(),
    ...(isRecord(existingLiteConfig) ? existingLiteConfig : {}),
    roleModels: {
      ...(isRecord(existingLiteConfig?.roleModels) ? existingLiteConfig.roleModels : {}),
    },
    roleReasoningEffort: {
      ...(isRecord(existingLiteConfig?.roleReasoningEffort) ? existingLiteConfig.roleReasoningEffort : {}),
    },
    taskLeadProfiles: {
      ...(isRecord(existingLiteConfig?.taskLeadProfiles) ? existingLiteConfig.taskLeadProfiles : {}),
    },
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
      ...(isRecord(existingLiteConfig?.modelPoolPolicy) ? existingLiteConfig.modelPoolPolicy : {}),
    },
  };
  const agents = isRecord(existingOpenCodeConfig.agent) ? existingOpenCodeConfig.agent : {};

  for (const roleName of MANAGED_AGENT_NAMES) {
    if (BUILTIN_AGENT_OVERRIDES.has(roleName)) continue;
    const agent = isRecord(agents[roleName]) ? agents[roleName] : {};
    if (!liteConfig.roleModels[roleName] && typeof agent.model === "string" && agent.model.includes("/")) {
      liteConfig.roleModels[roleName] = agent.model;
    }
    const effort = normalizeReasoningEffort(agent.reasoningEffort);
    if (!liteConfig.roleReasoningEffort[roleName] && effort) {
      liteConfig.roleReasoningEffort[roleName] = effort;
    }
  }

  const legacyProfiles = isRecord(existingOpenCodeConfig.taskLeadProfiles)
    ? existingOpenCodeConfig.taskLeadProfiles
    : {};
  for (const [profileName, profileValue] of Object.entries(legacyProfiles)) {
    if (!isRecord(profileValue)) continue;
    const profile = isRecord(liteConfig.taskLeadProfiles[profileName])
      ? { ...liteConfig.taskLeadProfiles[profileName] }
      : {};
    if (!profile.model && typeof profileValue.model === "string" && profileValue.model.includes("/")) {
      profile.model = profileValue.model;
    }
    const effort = normalizeReasoningEffort(profileValue.reasoningEffort);
    if (!profile.reasoningEffort && effort) profile.reasoningEffort = effort;
    if (Array.isArray(profileValue.fallbackModels) && !profile.fallbackModels) {
      profile.fallbackModels = profileValue.fallbackModels.filter((item) => typeof item === "string");
    }
    if (Object.keys(profile).length > 0) liteConfig.taskLeadProfiles[profileName] = profile;
  }

  return liteConfig;
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

function mergePermission(existingPermission, sourcePermission) {
  if (!isRecord(existingPermission)) return sourcePermission;
  if (!isRecord(sourcePermission)) return existingPermission;

  return {
    ...sourcePermission,
    ...existingPermission,
    bash: isRecord(existingPermission.bash) ? existingPermission.bash : sourcePermission.bash,
  };
}

function mergeMcp(existingMcp, sourceMcp, managedMcp = true) {
  if (!managedMcp || !isRecord(sourceMcp)) return existingMcp;
  const managedSourceMcp = Object.fromEntries(
    Object.entries(sourceMcp).filter(([serverName]) => MANAGED_MCP_NAMES.has(serverName)),
  );
  if (!isRecord(existingMcp)) return managedSourceMcp;

  return {
    ...managedSourceMcp,
    ...existingMcp,
  };
}

function mergeConfig(existingConfig, sourceConfig, configDir, options = {}) {
  const legacyTaskLeadProfiles = isRecord(existingConfig.taskLeadProfiles)
    ? existingConfig.taskLeadProfiles
    : undefined;
  const managedPluginOptions = readManagedPluginOptions(existingConfig);
  const pluginTaskLeadProfiles = isRecord(managedPluginOptions.taskLeadProfiles)
    ? managedPluginOptions.taskLeadProfiles
    : undefined;
  const taskLeadProfiles = pluginTaskLeadProfiles ?? legacyTaskLeadProfiles;
  const {
    taskLeadProfiles: _legacyTaskLeadProfiles,
    agent: _existingAgents,
    ...existingWithoutLegacyProfiles
  } = existingConfig;
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
  const customAgents = Object.fromEntries(
    Object.entries(existingConfig.agent ?? {}).filter(([agentName]) => (
      !MANAGED_AGENT_NAMES.has(agentName)
    )),
  );

  return {
    ...existingWithoutLegacyProfiles,
    $schema: existingConfig.$schema ?? sourceConfig.$schema,
    plugin: plugins,
    mcp: mergeMcp(existingConfig.mcp, sourceConfig.mcp, options.managedMcp),
    default_agent: sourceConfig.default_agent,
    permission: mergePermission(existingConfig.permission, sourceConfig.permission),
    command: {
      ...Object.fromEntries(
        Object.entries(existingConfig.command ?? {}).filter(([commandName]) => (
          !MANAGED_COMMAND_NAMES.has(commandName)
        )),
      ),
      ...(sourceConfig.command ?? {}),
    },
    ...(Object.keys(customAgents).length > 0 ? { agent: customAgents } : {}),
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

function applyLiteModelAssignments(liteConfig, assignments) {
  for (const [role, model] of Object.entries(assignments)) {
    if (typeof model !== "string" || !MANAGED_AGENT_NAMES.has(role)) continue;
    if (BUILTIN_AGENT_OVERRIDES.has(role)) continue;
    liteConfig.roleModels[role] = model;
  }
  return liteConfig;
}

function yamlScalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return value.flatMap((child) => {
      if (isRecord(child) || Array.isArray(child)) {
        return [`${prefix}-`, ...yamlLines(child, indent + 2)];
      }
      return [`${prefix}- ${yamlScalar(child)}`];
    });
  }
  if (!isRecord(value)) return [`${prefix}${yamlScalar(value)}`];
  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    const yamlKey = /^[a-zA-Z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
    if (isRecord(child) || Array.isArray(child)) {
      lines.push(`${prefix}${yamlKey}:`);
      lines.push(...yamlLines(child, indent + 2));
    } else {
      lines.push(`${prefix}${yamlKey}: ${yamlScalar(child)}`);
    }
  }
  return lines;
}

function agentFrontmatter(agent, liteConfig, agentName) {
  const frontmatter = { ...agent };
  delete frontmatter.prompt;
  const model = liteConfig.roleModels[agentName];
  if (model) frontmatter.model = model;
  delete frontmatter.reasoningEffort;
  return yamlLines(frontmatter).join("\n");
}

async function writeManagedAgentMarkdownFiles(rootDir, configDir, liteConfig, dryRun) {
  const targetAgentsDir = path.join(configDir, "agents");
  if (!dryRun) await mkdir(targetAgentsDir, { recursive: true });

  const sourceAgents = isRecord(MANAGED_CONFIG.agent) ? MANAGED_CONFIG.agent : {};
  for (const [agentName, agent] of Object.entries(sourceAgents)) {
    if (!isRecord(agent)) continue;
    const promptRef = typeof agent.prompt === "string" ? agent.prompt.match(/^\{file:(.*)\}$/)?.[1] : undefined;
    let promptText = "";
    if (promptRef) {
      promptText = await readFile(path.resolve(rootDir, promptRef), "utf8");
    } else {
      promptText = `# ${agentName}\n`;
    }
    const targetPath = path.join(targetAgentsDir, `${agentName}.md`);
    const existingContent = await fileExists(targetPath) ? await readFile(targetPath, "utf8") : "";
    const content = `---\n${agentFrontmatter(agent, liteConfig, agentName)}\n---\n\n${promptText.trimEnd()}\n`;
    if (!dryRun) {
      if (existingContent) {
        await writeFile(`${targetPath}.bak`, existingContent);
      }
      await writeFile(targetPath, content);
    }
  }
}

async function writeBackupIfExists(filePath) {
  if (await fileExists(filePath)) {
    await writeFile(`${filePath}.bak`, await readFile(filePath, "utf8"));
  }
}

async function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeBackupIfExists(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function prepareInstallContext(options) {
  const rootDir = path.resolve(
    options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const configDir = path.resolve(options.configDir ?? defaultConfigDir());
  const targetConfigPath = await resolveTargetConfigPath(configDir);
  const liteConfigPath = path.join(configDir, LITE_CONFIG_FILE);
  const existingConfig = await readJsonIfExists(targetConfigPath);
  const existingLiteConfig = await readJsonIfExists(liteConfigPath);

  return {
    rootDir,
    configDir,
    targetConfigPath,
    liteConfigPath,
    existingConfig,
    existingLiteConfig,
    dryRun: Boolean(options.dryRun),
    interactive: Boolean(options.interactive),
    managedMcp: options.managedMcp !== false,
    sourceOpenCodeDir: path.join(rootDir, ".opencode"),
    targetOpenCodeDir: path.join(configDir, ".opencode"),
  };
}

function mergeAll(context) {
  return {
    liteConfig: mergeLiteConfig(context.existingLiteConfig, context.existingConfig),
    mergedConfig: mergeConfig(context.existingConfig, MANAGED_CONFIG, context.configDir, {
      managedMcp: context.managedMcp,
    }),
  };
}

async function copyManagedDirs(context) {
  for (const managedDir of MANAGED_DIRS) {
    await copyDir(
      path.join(context.sourceOpenCodeDir, managedDir),
      path.join(context.targetOpenCodeDir, managedDir),
      context.dryRun,
    );
  }
}

async function runInteractiveSetup(liteConfig, context) {
  if (!context.interactive) return liteConfig;

  const providerAnswers = await promptProviders();
  if (!providerAnswers) return liteConfig;

  const availableModels = collectModelsFromProviders(providerAnswers);
  const result = resolveModelsForProviders(availableModels);

  console.log(formatModelAssignments(result));

  if (Object.keys(result.assignments).length > 0) {
    liteConfig = applyLiteModelAssignments(liteConfig, result.assignments);
    console.log(
      context.dryRun
        ? `  [Dry run] Model assignments would be written to ${LITE_CONFIG_FILE}.`
        : `  Model assignments will be written to ${LITE_CONFIG_FILE}.`,
    );
  }

  if (result.unresolved.length > 0) {
    console.log("  Some roles could not be matched. Consider adding more providers.");
    console.log("  You can use '/agent-models' in OpenCode to configure them manually.");
  }

  return liteConfig;
}

async function writeOutputs(context, mergedConfig, liteConfig) {
  await writeJson(context.targetConfigPath, mergedConfig, context.dryRun);
  await writeJson(context.liteConfigPath, liteConfig, context.dryRun);
  await writeManagedAgentMarkdownFiles(context.rootDir, context.configDir, liteConfig, context.dryRun);
}

export async function install(options = {}) {
  const context = await prepareInstallContext(options);
  const merged = mergeAll(context);

  await copyManagedDirs(context);
  const liteConfig = await runInteractiveSetup(merged.liteConfig, context);
  await writeOutputs(context, merged.mergedConfig, liteConfig);

  return {
    configDir: context.configDir,
    configPath: context.targetConfigPath,
    liteConfigPath: context.liteConfigPath,
    plugin: pathToFileURL(path.join(context.targetOpenCodeDir, "plugins", PLUGIN_FILE)).href,
    dryRun: context.dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await install(args);

  console.log(`OpenCode config: ${result.configPath}`);
  console.log(`Oh My Lite config: ${result.liteConfigPath}`);
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
