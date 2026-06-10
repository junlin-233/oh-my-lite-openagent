import { ROLE_CONTRACTS, type RoleName } from "../contracts.js";
import { DEFAULT_TASK_LEAD_PROFILES, isKnownTaskLeadProfile } from "./task-lead-profiles.js";
import type { ProviderModel } from "./model-config.js";

export const LITE_CONFIG_FILE = "oh-my-lite-openagent.json";
export const LITE_CONFIG_SCHEMA_VERSION = 1;

export type LiteReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface LiteTaskLeadProfileConfig {
  model?: string;
  reasoningEffort?: LiteReasoningEffort;
  fallbackModels?: string[];
}

export interface LiteOpenAgentConfig {
  schemaVersion: number;
  roleModels: Partial<Record<RoleName, string>>;
  roleReasoningEffort: Partial<Record<RoleName, LiteReasoningEffort>>;
  taskLeadProfiles: Record<string, LiteTaskLeadProfileConfig>;
  modelPoolPolicy?: Record<string, unknown>;
}

export interface ApplyLiteModelConfigResult {
  changed: Array<{ role: RoleName; previous?: string; next: string }>;
  skipped: Array<{ role: string; reason: string }>;
  warnings: Array<{ role: RoleName; warning: string }>;
}

export interface ApplyLiteReasoningConfigResult {
  changed: Array<{ role: RoleName; previous?: LiteReasoningEffort; next: LiteReasoningEffort; requested?: string }>;
  skipped: Array<{ role: string; reason: string }>;
}

export interface ApplyLiteTaskLeadProfileModelConfigResult {
  changed: Array<{ profile: string; previous?: string; next: string }>;
  skipped: Array<{ profile: string; reason: string }>;
  warnings: Array<{ profile: string; warning: string }>;
}

export interface ApplyLiteTaskLeadProfileReasoningConfigResult {
  changed: Array<{ profile: string; previous?: LiteReasoningEffort; next: LiteReasoningEffort; requested?: string }>;
  skipped: Array<{ profile: string; reason: string }>;
}

export const DEFAULT_ROLE_REASONING_EFFORT: Readonly<Record<RoleName, LiteReasoningEffort>> = {
  "command-lead": "high",
  "plan-builder": "high",
  "deep-plan-builder": "high",
  "task-lead": "medium",
  explore: "low",
  librarian: "low",
  "plan-review": "high",
  "result-review": "high",
};

export const DEFAULT_TASK_LEAD_PROFILE_REASONING_EFFORT: Readonly<Record<string, LiteReasoningEffort>> = {
  quick: "low",
  code: "medium",
  research: "low",
  writing: "medium",
  visual: "high",
  deep: "xhigh",
  "risk-high": "xhigh",
};

const ROLE_NAMES = new Set<string>(ROLE_CONTRACTS.map((role) => role.name));

export function createDefaultLiteConfig(): LiteOpenAgentConfig {
  return {
    schemaVersion: LITE_CONFIG_SCHEMA_VERSION,
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
    },
  };
}

export function readLiteConfig(value: unknown): LiteOpenAgentConfig {
  const input = isRecord(value) ? value : {};
  const config = createDefaultLiteConfig();

  config.schemaVersion = typeof input["schemaVersion"] === "number"
    ? input["schemaVersion"]
    : LITE_CONFIG_SCHEMA_VERSION;
  config.roleModels = readRoleModels(input["roleModels"]);
  config.roleReasoningEffort = readRoleReasoning(input["roleReasoningEffort"]);
  config.taskLeadProfiles = readProfileConfigs(input["taskLeadProfiles"]);
  if (isRecord(input["modelPoolPolicy"])) config.modelPoolPolicy = { ...input["modelPoolPolicy"] };

  return config;
}

export function mergeLiteConfig(
  current: LiteOpenAgentConfig,
  patch: Partial<LiteOpenAgentConfig>,
): LiteOpenAgentConfig {
  return {
    schemaVersion: patch.schemaVersion ?? current.schemaVersion ?? LITE_CONFIG_SCHEMA_VERSION,
    roleModels: {
      ...current.roleModels,
      ...(patch.roleModels ?? {}),
    },
    roleReasoningEffort: {
      ...current.roleReasoningEffort,
      ...(patch.roleReasoningEffort ?? {}),
    },
    taskLeadProfiles: {
      ...current.taskLeadProfiles,
      ...(patch.taskLeadProfiles ?? {}),
    },
    modelPoolPolicy: {
      ...(current.modelPoolPolicy ?? {}),
      ...(patch.modelPoolPolicy ?? {}),
    },
  };
}

export function migrateLiteConfigFromOpenCodeConfig(
  config: Record<string, unknown>,
  existing: LiteOpenAgentConfig = createDefaultLiteConfig(),
): LiteOpenAgentConfig {
  const patch: Partial<LiteOpenAgentConfig> = {
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
  };
  const agents = isRecord(config["agent"]) ? config["agent"] : {};

  for (const role of ROLE_CONTRACTS) {
    const rawAgent = agents[role.name];
    const agent: Record<string, unknown> = isRecord(rawAgent) ? rawAgent : {};
    const model = typeof agent["model"] === "string" && agent["model"].includes("/")
      ? agent["model"]
      : undefined;
    const effort = normalizeLiteReasoningEffort(agent["reasoningEffort"])
      ?? (isRecord(agent["options"]) ? normalizeLiteReasoningEffort(agent["options"]["reasoningEffort"]) : undefined);
    if (model && !existing.roleModels[role.name]) patch.roleModels![role.name] = model;
    if (effort && !existing.roleReasoningEffort[role.name]) patch.roleReasoningEffort![role.name] = effort;
  }

  const legacyProfiles = isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {};
  for (const [profileName, rawProfile] of Object.entries(legacyProfiles)) {
    if (!isKnownTaskLeadProfile(profileName) || !isRecord(rawProfile)) continue;
    const currentProfile = existing.taskLeadProfiles[profileName] ?? {};
    const nextProfile: LiteTaskLeadProfileConfig = { ...currentProfile };
    const model = typeof rawProfile["model"] === "string" && rawProfile["model"].includes("/")
      ? rawProfile["model"]
      : undefined;
    const effort = normalizeLiteReasoningEffort(rawProfile["reasoningEffort"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    if (model && !nextProfile.model) nextProfile.model = model;
    if (effort && !nextProfile.reasoningEffort) nextProfile.reasoningEffort = effort;
    if (fallbackModels.length > 0 && !nextProfile.fallbackModels) nextProfile.fallbackModels = fallbackModels;
    if (Object.keys(nextProfile).length > 0) patch.taskLeadProfiles![profileName] = nextProfile;
  }

  return mergeLiteConfig(existing, patch);
}

export function withLiteConfigAppliedToOpenCodeConfig(
  config: Record<string, unknown>,
  liteConfig: LiteOpenAgentConfig,
): Record<string, unknown> {
  const effective: Record<string, unknown> = {
    ...config,
    agent: {
      ...(isRecord(config["agent"]) ? config["agent"] : {}),
    },
    taskLeadProfiles: {
      ...(isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {}),
    },
  };
  const agents = effective["agent"] as Record<string, unknown>;
  const profiles = effective["taskLeadProfiles"] as Record<string, unknown>;

  for (const role of ROLE_CONTRACTS) {
    const rawAgent = agents[role.name];
    const agent: Record<string, unknown> = isRecord(rawAgent) ? { ...rawAgent } : {};
    const model = liteConfig.roleModels[role.name];
    const effort = liteConfig.roleReasoningEffort[role.name];
    const currentEffort = normalizeLiteReasoningEffort(agent["reasoningEffort"])
      ?? (isRecord(agent["options"]) ? normalizeLiteReasoningEffort(agent["options"]["reasoningEffort"]) : undefined);
    if (model) agent["model"] = model;
    if (effort && !currentEffort) agent["reasoningEffort"] = effort;
    agents[role.name] = agent;
  }

  for (const profile of DEFAULT_TASK_LEAD_PROFILES) {
    const rawProfile = profiles[profile.name];
    const current: Record<string, unknown> = isRecord(rawProfile) ? { ...rawProfile } : {};
    const configured = liteConfig.taskLeadProfiles[profile.name];
    if (configured?.model) current["model"] = configured.model;
    if (configured?.reasoningEffort) current["reasoningEffort"] = configured.reasoningEffort;
    if (configured?.fallbackModels && configured.fallbackModels.length > 0) {
      current["fallbackModels"] = configured.fallbackModels;
    }
    profiles[profile.name] = current;
  }

  return effective;
}

export function normalizeLiteReasoningEffort(value: unknown): LiteReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "none") return "minimal";
  if (normalized === "minimal") return "minimal";
  if (normalized === "low") return "low";
  if (normalized === "medium" || normalized === "med") return "medium";
  if (normalized === "high") return "high";
  if (
    normalized === "xhigh" ||
    normalized === "x-high" ||
    normalized === "extra-high" ||
    normalized === "extra_high" ||
    normalized === "very-high" ||
    normalized === "very_high"
  ) return "xhigh";
  if (normalized === "max" || normalized === "maximum") return "max";

  return undefined;
}

export function defaultRoleReasoningEffort(role: RoleName): LiteReasoningEffort {
  return DEFAULT_ROLE_REASONING_EFFORT[role];
}

export function defaultTaskLeadProfileReasoningEffort(profile: string): LiteReasoningEffort {
  return DEFAULT_TASK_LEAD_PROFILE_REASONING_EFFORT[profile] ?? "medium";
}

export function resolveSupportedReasoningEffort(input: {
  model?: ProviderModel | string;
  requested?: unknown;
  fallback: LiteReasoningEffort;
}): LiteReasoningEffort | undefined {
  const requested = normalizeLiteReasoningEffort(input.requested) ?? input.fallback;
  const supported = supportedReasoningEfforts(input.model);
  if (supported.length === 0) return undefined;

  for (const effort of downgradeChain(requested)) {
    if (supported.includes(effort)) return effort;
  }

  for (const effort of downgradeChain(input.fallback)) {
    if (supported.includes(effort)) return effort;
  }

  return undefined;
}

export function applyLiteRoleModelConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyLiteModelConfigResult {
  const availableModels = new Set(availableModelIds);
  const changed: ApplyLiteModelConfigResult["changed"] = [];
  const skipped: ApplyLiteModelConfigResult["skipped"] = [];
  const warnings: ApplyLiteModelConfigResult["warnings"] = [];

  for (const [role, modelValue] of Object.entries(assignments)) {
    if (!ROLE_NAMES.has(role)) {
      skipped.push({ role, reason: "unknown role" });
      continue;
    }
    if (typeof modelValue !== "string" || modelValue.trim() === "") {
      skipped.push({ role, reason: "model must be a non-empty string" });
      continue;
    }
    const model = modelValue.trim();
    if (!model.includes("/")) {
      skipped.push({ role, reason: "model must use provider/model format" });
      continue;
    }
    if (availableModels.size === 0 && !options.allowUnavailableModels) {
      skipped.push({ role, reason: "no imported model pool is available" });
      continue;
    }
    if (availableModels.size > 0 && !availableModels.has(model)) {
      if (!options.allowUnavailableModels) {
        skipped.push({ role, reason: "model is not in the imported model pool" });
        continue;
      }
      warnings.push({ role: role as RoleName, warning: "model was not found in the provider list; writing it anyway" });
    }

    const previous = liteConfig.roleModels[role as RoleName];
    liteConfig.roleModels[role as RoleName] = model;
    changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: model });
  }

  return { changed, skipped, warnings };
}

export function applyLiteRoleReasoningEffortConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
): ApplyLiteReasoningConfigResult {
  const changed: ApplyLiteReasoningConfigResult["changed"] = [];
  const skipped: ApplyLiteReasoningConfigResult["skipped"] = [];

  for (const [role, value] of Object.entries(assignments)) {
    if (!ROLE_NAMES.has(role)) {
      skipped.push({ role, reason: "unknown role" });
      continue;
    }
    const effort = normalizeLiteReasoningEffort(value);
    if (!effort) {
      const fallback = defaultRoleReasoningEffort(role as RoleName);
      const previous = liteConfig.roleReasoningEffort[role as RoleName];
      liteConfig.roleReasoningEffort[role as RoleName] = fallback;
      changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: fallback, requested: String(value) });
      continue;
    }
    const previous = liteConfig.roleReasoningEffort[role as RoleName];
    liteConfig.roleReasoningEffort[role as RoleName] = effort;
    changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: effort });
  }

  return { changed, skipped };
}

export function applyLiteTaskLeadProfileModelConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyLiteTaskLeadProfileModelConfigResult {
  const availableModels = new Set(availableModelIds);
  const changed: ApplyLiteTaskLeadProfileModelConfigResult["changed"] = [];
  const skipped: ApplyLiteTaskLeadProfileModelConfigResult["skipped"] = [];
  const warnings: ApplyLiteTaskLeadProfileModelConfigResult["warnings"] = [];

  for (const [profileName, modelValue] of Object.entries(assignments)) {
    if (!isKnownTaskLeadProfile(profileName)) {
      skipped.push({ profile: profileName, reason: "unknown task lead profile" });
      continue;
    }
    if (typeof modelValue !== "string" || modelValue.trim() === "") {
      skipped.push({ profile: profileName, reason: "model must be a non-empty string" });
      continue;
    }
    const model = modelValue.trim();
    if (!model.includes("/")) {
      skipped.push({ profile: profileName, reason: "model must use provider/model format" });
      continue;
    }
    if (availableModels.size === 0 && !options.allowUnavailableModels) {
      skipped.push({ profile: profileName, reason: "no imported model pool is available" });
      continue;
    }
    if (availableModels.size > 0 && !availableModels.has(model)) {
      if (!options.allowUnavailableModels) {
        skipped.push({ profile: profileName, reason: "model is not in the imported model pool" });
        continue;
      }
      warnings.push({ profile: profileName, warning: "model was not found in the provider list; writing it anyway" });
    }

    const profile: LiteTaskLeadProfileConfig = liteConfig.taskLeadProfiles[profileName] ?? {};
    const previous = profile.model;
    liteConfig.taskLeadProfiles[profileName] = { ...profile, model };
    changed.push({ profile: profileName, ...(previous ? { previous } : {}), next: model });
  }

  return { changed, skipped, warnings };
}

export function applyLiteTaskLeadProfileReasoningEffortConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
): ApplyLiteTaskLeadProfileReasoningConfigResult {
  const changed: ApplyLiteTaskLeadProfileReasoningConfigResult["changed"] = [];
  const skipped: ApplyLiteTaskLeadProfileReasoningConfigResult["skipped"] = [];

  for (const [profileName, value] of Object.entries(assignments)) {
    if (!isKnownTaskLeadProfile(profileName)) {
      skipped.push({ profile: profileName, reason: "unknown task lead profile" });
      continue;
    }
    const effort = normalizeLiteReasoningEffort(value) ?? defaultTaskLeadProfileReasoningEffort(profileName);
    const profile = liteConfig.taskLeadProfiles[profileName] ?? {};
    const previous = profile.reasoningEffort;
    liteConfig.taskLeadProfiles[profileName] = { ...profile, reasoningEffort: effort };
    changed.push({ profile: profileName, ...(previous ? { previous } : {}), next: effort, ...(normalizeLiteReasoningEffort(value) ? {} : { requested: String(value) }) });
  }

  return { changed, skipped };
}

function supportedReasoningEfforts(model?: ProviderModel | string): LiteReasoningEffort[] {
  const modelId = typeof model === "string" ? model : model?.id;
  const provider = typeof model === "string" ? model.split("/")[0] : model?.provider;
  const variants = typeof model === "string" ? [] : (model?.variants ?? []);
  const normalizedVariants = variants
    .map((variant) => normalizeLiteReasoningEffort(variant))
    .filter((variant): variant is LiteReasoningEffort => Boolean(variant));

  if (normalizedVariants.length > 0) return [...new Set(normalizedVariants)];
  if (typeof model !== "string" && model?.reasoning === false) return [];

  const normalizedProvider = provider?.toLowerCase();
  if (normalizedProvider === "opencode" || normalizedProvider === "opencode-go") {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (
    normalizedProvider === "openai" ||
    normalizedProvider === "anthropic" ||
    normalizedProvider === "google" ||
    normalizedProvider === "github-copilot" ||
    normalizedProvider === "kimi-for-coding"
  ) {
    return ["low", "medium", "high"];
  }
  if (modelId && (modelId.toLowerCase().includes("gpt") || modelId.toLowerCase().includes("claude") || modelId.toLowerCase().includes("gemini"))) {
    return ["low", "medium", "high"];
  }

  return [];
}

function downgradeChain(effort: LiteReasoningEffort): LiteReasoningEffort[] {
  if (effort === "max") return ["max", "xhigh", "high", "medium", "low"];
  if (effort === "xhigh") return ["xhigh", "high", "medium", "low"];
  if (effort === "high") return ["high", "medium", "low"];
  if (effort === "medium") return ["medium", "low"];
  if (effort === "low") return ["low"];
  return ["minimal", "low"];
}

function readRoleModels(value: unknown): Partial<Record<RoleName, string>> {
  const result: Partial<Record<RoleName, string>> = {};
  if (!isRecord(value)) return result;
  for (const [role, model] of Object.entries(value)) {
    if (ROLE_NAMES.has(role) && typeof model === "string" && model.includes("/")) {
      result[role as RoleName] = model;
    }
  }
  return result;
}

function readRoleReasoning(value: unknown): Partial<Record<RoleName, LiteReasoningEffort>> {
  const result: Partial<Record<RoleName, LiteReasoningEffort>> = {};
  if (!isRecord(value)) return result;
  for (const [role, effortValue] of Object.entries(value)) {
    const effort = normalizeLiteReasoningEffort(effortValue);
    if (ROLE_NAMES.has(role) && effort) result[role as RoleName] = effort;
  }
  return result;
}

function readProfileConfigs(value: unknown): Record<string, LiteTaskLeadProfileConfig> {
  const result: Record<string, LiteTaskLeadProfileConfig> = {};
  if (!isRecord(value)) return result;
  for (const [profileName, rawProfile] of Object.entries(value)) {
    if (!isKnownTaskLeadProfile(profileName) || !isRecord(rawProfile)) continue;
    const profile: LiteTaskLeadProfileConfig = {};
    if (typeof rawProfile["model"] === "string" && rawProfile["model"].includes("/")) profile.model = rawProfile["model"];
    const effort = normalizeLiteReasoningEffort(rawProfile["reasoningEffort"]);
    if (effort) profile.reasoningEffort = effort;
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    if (fallbackModels.length > 0) profile.fallbackModels = fallbackModels;
    if (Object.keys(profile).length > 0) result[profileName] = profile;
  }
  return result;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
