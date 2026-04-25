import { ROLE_CONTRACTS, type RoleName } from "../contracts.js";
import {
  type AutoModelResult,
  resolveAutoModels,
  ROLE_MODEL_PROFILES,
  ROLE_CAPABILITY_DESCRIPTIONS,
  type RoleCapability,
  formatAutoModelReport,
} from "./role-model-recommendations.js";
import {
  DEFAULT_TASK_LEAD_PROFILES,
  formatTaskLeadProfileModelReport,
  isKnownTaskLeadProfile,
  resolveAutoTaskLeadProfileModels,
  type AutoTaskLeadProfileModelResult,
} from "./task-lead-profiles.js";

export {
  resolveAutoModels,
  ROLE_MODEL_PROFILES,
  ROLE_CAPABILITY_DESCRIPTIONS,
  type RoleCapability,
  type AutoModelResult,
  formatAutoModelReport,
  DEFAULT_TASK_LEAD_PROFILES,
  formatTaskLeadProfileModelReport,
  resolveAutoTaskLeadProfileModels,
  type AutoTaskLeadProfileModelResult,
};

export const CONFIGURABLE_ROLE_NAMES = ROLE_CONTRACTS.map((role) => role.name);

export type ModelAssignment = Partial<Record<RoleName, string>>;

export interface RoleModelSummary {
  role: RoleName;
  mode?: string;
  configuredModel?: string;
  effectiveModel?: string;
  inheritsGlobal: boolean;
}

export interface TaskLeadProfileModelSummary {
  profile: string;
  configuredModel?: string;
  fallbackModels: string[];
  effectiveModel?: string;
  inheritsTaskLeadModel: boolean;
  fallbackPatterns: string[];
}

export interface ProviderModel {
  provider: string;
  model: string;
  id: string;
  name?: string;
  source?: ModelProviderSource;
  family?: ModelFamily;
  origin?: ModelOrigin;
}

export type ModelProviderSource =
  | "opencode-subscription"
  | "api-provider"
  | "gateway"
  | "unknown";

export type ModelFamily =
  | "gpt"
  | "claude"
  | "gemini"
  | "kimi"
  | "minimax"
  | "glm"
  | "codex"
  | "other";

export type ModelOrigin =
  | "opencode-json-provider"
  | "runtime-provider-list"
  | "configured-model"
  | "credential-provider-fallback";

export interface ModelPoolPolicy {
  source?: ModelProviderSource | "all";
  providerPreference?: readonly string[];
  familyPreference?: readonly ModelFamily[];
  allowCodexBackend?: boolean;
}

export interface InferredModelPoolPolicy {
  policy: ModelPoolPolicy;
  reason: string;
}

export interface ApplyModelConfigResult {
  changed: Array<{
    role: RoleName;
    previous?: string;
    next: string;
  }>;
  skipped: Array<{
    role: string;
    reason: string;
  }>;
  warnings: Array<{
    role: RoleName;
    warning: string;
  }>;
}

export interface ApplyTaskLeadProfileModelConfigResult {
  changed: Array<{
    profile: string;
    previous?: string;
    next: string;
  }>;
  skipped: Array<{
    profile: string;
    reason: string;
  }>;
  warnings: Array<{
    profile: string;
    warning: string;
  }>;
}

export function listProviderModels(config: Record<string, unknown>): ProviderModel[] {
  const providerConfig = config["provider"];

  let models: ProviderModel[] = [];

  // Strategy 1: Read from explicit provider.models config (opencode.json "provider" key)
  if (isRecord(providerConfig)) {
    for (const [provider, providerValue] of Object.entries(providerConfig)) {
      if (!isRecord(providerValue)) continue;

      // Check for provider.models format
      if (isRecord(providerValue["models"])) {
        for (const [model, modelValue] of Object.entries(providerValue["models"])) {
          const name = isRecord(modelValue) && typeof modelValue["name"] === "string"
            ? modelValue["name"]
            : undefined;

          models.push({
            provider,
            model,
            id: `${provider}/${model}`,
            ...(name ? { name } : {}),
            source: classifyModelProvider(provider),
            family: classifyModelFamily(`${provider}/${model}`),
            origin: "opencode-json-provider",
          });
        }
      }

      // Check for direct apiKey format (provider with apiKey but no models list)
      // e.g. "openai": { "apiKey": "sk-..." } or "anthropic": { "apiKey": "sk-ant-..." }
      // These providers are connected but don't enumerate models in config
      if (typeof providerValue["apiKey"] === "string" && !isRecord(providerValue["models"])) {
        // Provider is connected but models must be discovered at runtime
      }
    }
  }

  // Strategy 2: Read models from agent config (infer from what's already assigned)
  // This catches cases where providers were connected via /connect but their
  // models aren't listed in opencode.json — the models may already be configured
  // on individual agents.
  const agents = isRecord(config["agent"]) ? config["agent"] : {};
  const globalModel = typeof config["model"] === "string" ? config["model"] : undefined;
  const seenIds = new Set(models.map((m) => m.id));

  if (globalModel && globalModel.includes("/")) {
    const parts = globalModel.split("/");
    if (parts.length === 2 && !seenIds.has(globalModel)) {
      models.push({
        provider: parts[0]!,
        model: parts[1]!,
        id: globalModel,
        source: classifyModelProvider(parts[0]!),
        family: classifyModelFamily(globalModel),
        origin: "configured-model",
      });
      seenIds.add(globalModel);
    }
  }

  for (const agentValue of Object.values(agents)) {
    if (!isRecord(agentValue)) continue;
    const agentModel = typeof agentValue["model"] === "string" ? agentValue["model"] : undefined;
    if (agentModel && agentModel.includes("/")) {
      const parts = agentModel.split("/");
      if (parts.length === 2 && !seenIds.has(agentModel)) {
        models.push({
          provider: parts[0]!,
          model: parts[1]!,
          id: agentModel,
          source: classifyModelProvider(parts[0]!),
          family: classifyModelFamily(agentModel),
          origin: "configured-model",
        });
        seenIds.add(agentModel);
      }
    }
  }

  const taskLeadProfiles = isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {};
  for (const profileValue of Object.values(taskLeadProfiles)) {
    if (!isRecord(profileValue)) continue;
    const profileModels = [
      typeof profileValue["model"] === "string" ? profileValue["model"] : undefined,
      ...readStringArray(profileValue["fallbackModels"]),
    ];

    for (const profileModel of profileModels) {
      if (profileModel && profileModel.includes("/")) {
        const parts = profileModel.split("/");
        if (parts.length === 2 && !seenIds.has(profileModel)) {
          models.push({
            provider: parts[0]!,
            model: parts[1]!,
            id: profileModel,
            source: classifyModelProvider(parts[0]!),
            family: classifyModelFamily(profileModel),
            origin: "configured-model",
          });
          seenIds.add(profileModel);
        }
      }
    }
  }

  return models.sort((left, right) => left.id.localeCompare(right.id));
}

export function listProviderModelsFromResponse(response: unknown): ProviderModel[] {
  const payload = unwrapResponseData(response);
  const providers = extractProviders(payload);
  const models: ProviderModel[] = [];

  for (const provider of providers) {
    if (!isRecord(provider) || typeof provider["id"] !== "string") continue;

    const providerID = provider["id"];
    const providerModels = provider["models"];
    if (!isRecord(providerModels)) continue;

    for (const [modelKey, modelValue] of Object.entries(providerModels)) {
      const modelID = isRecord(modelValue) && typeof modelValue["id"] === "string"
        ? modelValue["id"]
        : modelKey;
      const name = isRecord(modelValue) && typeof modelValue["name"] === "string"
        ? modelValue["name"]
        : undefined;

      models.push({
        provider: providerID,
        model: modelID,
        id: `${providerID}/${modelID}`,
        ...(name ? { name } : {}),
        source: classifyModelProvider(providerID),
        family: classifyModelFamily(`${providerID}/${modelID}`),
        origin: "runtime-provider-list",
      });
    }
  }

  return dedupeModels(models);
}

export function mergeProviderModels(
  primary: readonly ProviderModel[],
  fallback: readonly ProviderModel[],
): ProviderModel[] {
  return dedupeModels([...primary, ...fallback]);
}

export function listKnownModelsForCredentialProviders(providerIds: readonly string[]): ProviderModel[] {
  const connectedProviders = new Set(providerIds.map((provider) => provider.toLowerCase()));
  const models: ProviderModel[] = [];

  if (connectedProviders.has("opencode")) {
    models.push(
      { provider: "opencode", model: "claude-opus-4-7", id: "opencode/claude-opus-4-7" },
      { provider: "opencode", model: "claude-sonnet-4-6", id: "opencode/claude-sonnet-4-6" },
      { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
      { provider: "opencode", model: "big-pickle", id: "opencode/big-pickle" },
      { provider: "opencode", model: "kimi-k2.5", id: "opencode/kimi-k2.5" },
    );
  }

  if (connectedProviders.has("opencode-go")) {
    models.push(
      { provider: "opencode-go", model: "kimi-k2.5", id: "opencode-go/kimi-k2.5" },
      { provider: "opencode-go", model: "minimax-m2.7", id: "opencode-go/minimax-m2.7" },
      { provider: "opencode-go", model: "minimax-m2.7-highspeed", id: "opencode-go/minimax-m2.7-highspeed" },
      { provider: "opencode-go", model: "glm-5", id: "opencode-go/glm-5" },
    );
  }

  return dedupeModels(models.map((model) => withModelMetadata({
    ...model,
    origin: "credential-provider-fallback",
  })));
}

export function importModelPool(
  models: readonly ProviderModel[],
  policy: ModelPoolPolicy = {},
): ProviderModel[] {
  const source = policy.source ?? "all";
  const allowCodexBackend = policy.allowCodexBackend ?? false;
  const providerPreference = new Set(
    (policy.providerPreference ?? []).map((provider) => provider.toLowerCase()),
  );
  const familyPreference = new Set(policy.familyPreference ?? []);

  return dedupeModels(models.map(withModelMetadata).filter((model) => {
    if (source !== "all" && model.source !== source) return false;
    if (providerPreference.size > 0 && !providerPreference.has(model.provider.toLowerCase())) return false;
    if (familyPreference.size > 0 && !familyPreference.has(model.family ?? "other")) return false;
    if (!allowCodexBackend && isCodexModel(model)) return false;
    return true;
  }));
}

export function inferModelPoolPolicy(
  config: Record<string, unknown>,
  explicitPolicy: ModelPoolPolicy = {},
): InferredModelPoolPolicy {
  const globalModel = typeof config["model"] === "string" ? config["model"] : undefined;
  const provider = globalModel?.includes("/") ? globalModel.split("/")[0] : undefined;
  const basePolicy: ModelPoolPolicy = {
    source: "all",
    allowCodexBackend: false,
  };
  const source = explicitPolicy.source ?? basePolicy.source;
  const providerPreference = explicitPolicy.providerPreference ?? basePolicy.providerPreference;
  const familyPreference = explicitPolicy.familyPreference;
  const allowCodexBackend = explicitPolicy.allowCodexBackend ?? basePolicy.allowCodexBackend;

  return {
    policy: {
      ...(source ? { source } : {}),
      ...(providerPreference ? { providerPreference } : {}),
      ...(familyPreference ? { familyPreference } : {}),
      ...(typeof allowCodexBackend === "boolean" ? { allowCodexBackend } : {}),
    },
    reason: provider
      ? `Global model ${globalModel} detected; importing all discovered OpenCode model providers by default.`
      : "No global model was configured; importing all discovered OpenCode model providers by default.",
  };
}

export function summarizeRoleModels(config: Record<string, unknown>): RoleModelSummary[] {
  const globalModel = typeof config["model"] === "string" ? config["model"] : undefined;
  const agents = isRecord(config["agent"]) ? config["agent"] : {};

  return CONFIGURABLE_ROLE_NAMES.map((role) => {
    const agent = isRecord(agents[role]) ? agents[role] : {};
    const configuredModel = typeof agent["model"] === "string" ? agent["model"] : undefined;
    const mode = typeof agent["mode"] === "string" ? agent["mode"] : undefined;
    const effectiveModel = configuredModel ?? globalModel;

    return {
      role,
      ...(mode ? { mode } : {}),
      ...(configuredModel ? { configuredModel } : {}),
      ...(effectiveModel ? { effectiveModel } : {}),
      inheritsGlobal: !configuredModel,
    };
  });
}

export function summarizeTaskLeadProfileModels(config: Record<string, unknown>): TaskLeadProfileModelSummary[] {
  const agents = isRecord(config["agent"]) ? config["agent"] : {};
  const taskLead = isRecord(agents["task-lead"]) ? agents["task-lead"] : {};
  const globalModel = typeof config["model"] === "string" ? config["model"] : undefined;
  const taskLeadModel = typeof taskLead["model"] === "string" ? taskLead["model"] : globalModel;
  const profileConfig = isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {};

  return DEFAULT_TASK_LEAD_PROFILES.map((profile) => {
    const rawConfigured = profileConfig[profile.name];
    const configured: Record<string, unknown> = isRecord(rawConfigured) ? rawConfigured : {};
    const configuredModel = typeof configured["model"] === "string" ? configured["model"] : undefined;
    const fallbackModels = readStringArray(configured["fallbackModels"]);
    const effectiveModel = configuredModel ?? taskLeadModel;

    return {
      profile: profile.name,
      fallbackModels,
      fallbackPatterns: profile.fallbackPatterns.map((entry) => entry.pattern),
      ...(configuredModel ? { configuredModel } : {}),
      ...(effectiveModel ? { effectiveModel } : {}),
      inheritsTaskLeadModel: !configuredModel,
    };
  });
}

export function applyRoleModelConfig(
  config: Record<string, unknown>,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyModelConfigResult {
  const agents = ensureRecord(config, "agent");
  const validRoles = new Set<string>(CONFIGURABLE_ROLE_NAMES);
  const availableModels = new Set(availableModelIds);
  const changed: ApplyModelConfigResult["changed"] = [];
  const skipped: ApplyModelConfigResult["skipped"] = [];
  const warnings: ApplyModelConfigResult["warnings"] = [];

  for (const [role, modelValue] of Object.entries(assignments)) {
    if (!validRoles.has(role)) {
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

      warnings.push({
        role: role as RoleName,
        warning: "model was not found in the provider list; writing it anyway",
      });
    }

    const agent = ensureRecord(agents, role);
    const previous = typeof agent["model"] === "string" ? agent["model"] : undefined;

    agent["model"] = model;
    changed.push({
      role: role as RoleName,
      ...(previous ? { previous } : {}),
      next: model,
    });
  }

  return { changed, skipped, warnings };
}

export function applyTaskLeadProfileModelConfig(
  config: Record<string, unknown>,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyTaskLeadProfileModelConfigResult {
  const profiles = ensureRecord(config, "taskLeadProfiles");
  const availableModels = new Set(availableModelIds);
  const changed: ApplyTaskLeadProfileModelConfigResult["changed"] = [];
  const skipped: ApplyTaskLeadProfileModelConfigResult["skipped"] = [];
  const warnings: ApplyTaskLeadProfileModelConfigResult["warnings"] = [];

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

      warnings.push({
        profile: profileName,
        warning: "model was not found in the provider list; writing it anyway",
      });
    }

    const profile = ensureRecord(profiles, profileName);
    const previous = typeof profile["model"] === "string" ? profile["model"] : undefined;

    profile["model"] = model;
    changed.push({
      profile: profileName,
      ...(previous ? { previous } : {}),
      next: model,
    });
  }

  return { changed, skipped, warnings };
}

export function formatModelConfigReport(input: {
  roles: RoleModelSummary[];
  models: ProviderModel[];
  taskLeadProfiles?: TaskLeadProfileModelSummary[];
  changed?: ApplyModelConfigResult["changed"];
  skipped?: ApplyModelConfigResult["skipped"];
  warnings?: ApplyModelConfigResult["warnings"];
  profileChanged?: ApplyTaskLeadProfileModelConfigResult["changed"];
  profileSkipped?: ApplyTaskLeadProfileModelConfigResult["skipped"];
  profileWarnings?: ApplyTaskLeadProfileModelConfigResult["warnings"];
}): string {
  const lines = [
    "Oh My Lite OpenAgent role model configuration",
    "",
    "Current role models:",
    ...input.roles.map((role) => {
      const source = role.inheritsGlobal ? "inherits global" : "configured";
      return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
    }),
    "",
    "Available provider models:",
    ...(
      input.models.length > 0
        ? input.models.map((model) => {
          const source = model.source ?? classifyModelProvider(model.provider);
          const family = model.family ?? classifyModelFamily(model.id);
          const origin = model.origin ? ` ${model.origin}` : "";
          return `- ${model.id}${model.name ? ` (${model.name})` : ""} [${source}/${family}${origin}]`;
        })
        : ["- <none found in opencode.json provider config>"]
    ),
  ];

  if (input.taskLeadProfiles) {
    lines.push("", "Task Lead profile models:");
    lines.push(...input.taskLeadProfiles.map((profile) => {
      const source = profile.inheritsTaskLeadModel ? "inherits task-lead" : "configured";
      const fallback = profile.fallbackModels.length > 0
        ? ` fallback=${profile.fallbackModels.join(",")}`
        : "";
      return `- ${profile.profile}: ${profile.effectiveModel ?? "<unset>"} (${source})${fallback}`;
    }));
  }

  if (input.changed) {
    lines.push("", "Changes applied:");
    lines.push(
      ...(
        input.changed.length > 0
          ? input.changed.map((change) => (
            `- ${change.role}: ${change.previous ?? "<inherited>"} -> ${change.next}`
          ))
          : ["- <none>"]
      ),
    );
  }

  if (input.skipped && input.skipped.length > 0) {
    lines.push("", "Skipped:");
    lines.push(...input.skipped.map((item) => `- ${item.role}: ${item.reason}`));
  }

  if (input.warnings && input.warnings.length > 0) {
    lines.push("", "Warnings:");
    lines.push(...input.warnings.map((item) => `- ${item.role}: ${item.warning}`));
  }

  if (input.profileChanged) {
    lines.push("", "Task Lead profile changes applied:");
    lines.push(
      ...(
        input.profileChanged.length > 0
          ? input.profileChanged.map((change) => (
            `- ${change.profile}: ${change.previous ?? "<inherited>"} -> ${change.next}`
          ))
          : ["- <none>"]
      ),
    );
  }

  if (input.profileSkipped && input.profileSkipped.length > 0) {
    lines.push("", "Task Lead profile skipped:");
    lines.push(...input.profileSkipped.map((item) => `- ${item.profile}: ${item.reason}`));
  }

  if (input.profileWarnings && input.profileWarnings.length > 0) {
    lines.push("", "Task Lead profile warnings:");
    lines.push(...input.profileWarnings.map((item) => `- ${item.profile}: ${item.warning}`));
  }

  return lines.join("\n");
}

export function formatModelImportReport(input: {
  models: ProviderModel[];
  policy?: ModelPoolPolicy;
}): string {
  const source = input.policy?.source ?? "all";
  const allowCodexBackend = input.policy?.allowCodexBackend ?? false;
  const lines = [
    "Oh My Lite OpenAgent imported model pool",
    "",
    `Source filter: ${source}`,
    `Codex backend models: ${allowCodexBackend ? "allowed" : "excluded"}`,
    "",
    "Imported models:",
    ...(
      input.models.length > 0
        ? input.models.map((model) => {
          const modelSource = model.source ?? classifyModelProvider(model.provider);
          const family = model.family ?? classifyModelFamily(model.id);
          return `- ${model.id} [${modelSource}/${family}]`;
        })
        : ["- <none>"]
    ),
  ];

  if (input.models.length === 0) {
    lines.push(
      "",
      "No usable models were imported.",
      "Connect or configure OpenCode providers, or pass an explicit policy if you want to inspect a narrower pool.",
    );
  }

  return lines.join("\n");
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];

  if (isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function dedupeModels(models: readonly ProviderModel[]): ProviderModel[] {
  const seen = new Map<string, ProviderModel>();

  for (const model of models) {
    if (!seen.has(model.id)) seen.set(model.id, model);
  }

  return [...seen.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function classifyModelProvider(provider: string): ModelProviderSource {
  const normalized = provider.toLowerCase();

  if (
    normalized === "opencode" ||
    normalized === "opencode-go"
  ) {
    return "opencode-subscription";
  }

  if (
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "google" ||
    normalized === "github-copilot" ||
    normalized === "kimi-for-coding"
  ) {
    return "api-provider";
  }

  if (normalized === "vercel") {
    return "gateway";
  }

  return "unknown";
}

export function classifyModelFamily(modelId: string): ModelFamily {
  const normalized = modelId.toLowerCase();

  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("kimi") || normalized.includes("k2")) return "kimi";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("glm")) return "glm";
  if (normalized.includes("gpt")) return "gpt";

  return "other";
}

export function isCodexModel(model: ProviderModel): boolean {
  return (model.family ?? classifyModelFamily(model.id)) === "codex";
}

function withModelMetadata(model: ProviderModel): ProviderModel {
  return {
    ...model,
    source: model.source ?? classifyModelProvider(model.provider),
    family: model.family ?? classifyModelFamily(model.id),
  };
}

function extractProviders(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;

  if (!isRecord(payload)) return [];

  const providers = payload["providers"] ?? payload["all"];
  return Array.isArray(providers) ? providers : [];
}

function unwrapResponseData(response: unknown): unknown {
  if (!isRecord(response)) return response;

  return response["data"] ?? response["response"] ?? response;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
