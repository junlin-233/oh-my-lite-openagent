import { ROLE_CONTRACTS, type RoleName } from "../contracts.js";

export const CONFIGURABLE_ROLE_NAMES = ROLE_CONTRACTS.map((role) => role.name);

export type ModelAssignment = Partial<Record<RoleName, string>>;

export interface RoleModelSummary {
  role: RoleName;
  mode?: string;
  configuredModel?: string;
  effectiveModel?: string;
  inheritsGlobal: boolean;
}

export interface ProviderModel {
  provider: string;
  model: string;
  id: string;
  name?: string;
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

export function listProviderModels(config: Record<string, unknown>): ProviderModel[] {
  const providerConfig = config["provider"];

  if (!isRecord(providerConfig)) return [];

  const models: ProviderModel[] = [];

  for (const [provider, providerValue] of Object.entries(providerConfig)) {
    if (!isRecord(providerValue) || !isRecord(providerValue["models"])) continue;

    for (const [model, modelValue] of Object.entries(providerValue["models"])) {
      const name = isRecord(modelValue) && typeof modelValue["name"] === "string"
        ? modelValue["name"]
        : undefined;

      models.push({
        provider,
        model,
        id: `${provider}/${model}`,
        ...(name ? { name } : {}),
      });
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

export function applyRoleModelConfig(
  config: Record<string, unknown>,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
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

    if (availableModels.size > 0 && !availableModels.has(model)) {
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

export function formatModelConfigReport(input: {
  roles: RoleModelSummary[];
  models: ProviderModel[];
  changed?: ApplyModelConfigResult["changed"];
  skipped?: ApplyModelConfigResult["skipped"];
  warnings?: ApplyModelConfigResult["warnings"];
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
        ? input.models.map((model) => `- ${model.id}${model.name ? ` (${model.name})` : ""}`)
        : ["- <none found in opencode.json provider config>"]
    ),
  ];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
