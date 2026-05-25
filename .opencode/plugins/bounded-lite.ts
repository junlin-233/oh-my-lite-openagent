import { MAX_CHILD_ORCHESTRATOR_DEPTH, ROLE_CONTRACTS, type RoutingCategory } from "../lib/contracts.js";
import { BackgroundCoordinator } from "../lib/runtime/background.js";
import {
  type PluginHooks,
  type PluginInput,
} from "../lib/runtime/plugin-types.js";
import { resolveCategoryRoute } from "../lib/runtime/categories.js";
import { buildTaskDAG, type TaskDispatchConfig } from "../lib/runtime/plan-dag.js";
import { validatePlanReadiness } from "../lib/runtime/plan-readiness.js";
import {
  ensureOpenPlanIndexHealthyOnce,
  rebuildOpenPlanIndex,
  writePlanArtifact,
} from "../lib/runtime/plan-artifact.js";
import { createRuntimeProfile } from "../lib/runtime/safety.js";
import {
  applyRoleModelConfig,
  applyRoleReasoningEffortConfig,
  applyTaskLeadProfileModelConfig,
  buildDiscoveredModelPool,
  formatAutoModelReport,
  formatModelImportReport,
  formatModelConfigReport,
  formatTaskLeadProfileModelReport,
  importModelPool,
  inferModelPoolPolicy,
  listKnownModelsForCredentialProviders,
  listProviderModels,
  listProviderModelsFromModelsDevResponse,
  listProviderModelsFromResponse,
  mergeProviderModels,
  type ModelFamily,
  type ModelPoolPolicy,
  type ModelProviderSource,
  resolveAutoModels,
  resolveAutoReasoningEffortAssignments,
  resolveAutoTaskLeadProfileModels,
  summarizeRoleModels,
  summarizeTaskLeadProfileModels,
} from "../lib/runtime/model-config.js";
import {
  applyLiteRoleModelConfig,
  applyLiteRoleReasoningEffortConfig,
  applyLiteTaskLeadProfileModelConfig,
  applyLiteTaskLeadProfileReasoningEffortConfig,
  createDefaultLiteConfig,
  defaultRoleReasoningEffort,
  LITE_CONFIG_FILE,
  migrateLiteConfigFromOpenCodeConfig,
  readLiteConfig,
  resolveSupportedReasoningEffort,
  type LiteOpenAgentConfig,
  withLiteConfigAppliedToOpenCodeConfig,
} from "../lib/runtime/lite-config.js";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isKnownTaskLeadProfile } from "../lib/runtime/task-lead-profiles.js";
import { tool } from "@opencode-ai/plugin/tool";

const PLUGIN_FILE = "bounded-lite.ts";

export interface BoundedLitePluginOptions {
  mode?: "full" | "degraded";
  enableHooks?: boolean;
  enableBackground?: boolean;
  enableBundledMcp?: boolean;
  maxChildDepth?: number;
  configDir?: string;
  taskLeadProfiles?: Record<string, unknown>;
}

export interface NormalizedBoundedLitePluginOptions {
  mode: "full" | "degraded";
  enableHooks: boolean;
  enableBackground: boolean;
  enableBundledMcp: boolean;
  maxChildDepth: number;
  configDir?: string;
  taskLeadProfiles?: Record<string, unknown>;
}

export function normalizePluginOptions(
  options: BoundedLitePluginOptions = {},
): NormalizedBoundedLitePluginOptions {
  const mode = options.mode ?? "full";

  return {
    mode,
    enableHooks: options.enableHooks ?? true,
    enableBackground: options.enableBackground ?? mode === "full",
    enableBundledMcp: options.enableBundledMcp ?? false,
    maxChildDepth: options.maxChildDepth ?? MAX_CHILD_ORCHESTRATOR_DEPTH,
    ...(typeof options.configDir === "string" && options.configDir.trim() !== ""
      ? { configDir: options.configDir }
      : {}),
    ...(typeof options.taskLeadProfiles === "object" &&
        options.taskLeadProfiles !== null &&
        !Array.isArray(options.taskLeadProfiles)
      ? { taskLeadProfiles: normalizeTaskLeadProfilesConfig(options.taskLeadProfiles) }
      : {}),
  };
}

function isRoutingCategory(value: unknown): value is RoutingCategory {
  return (
    value === "execution" ||
    value === "planning" ||
    value === "deep-planning" ||
    value === "explore" ||
    value === "librarian" ||
    value === "plan-review" ||
    value === "result-review"
  );
}

function defaultConfigDir(configDir?: string): string {
  if (process.env.OPENCODE_CONFIG_DIR) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  if (configDir) return path.resolve(configDir);

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "opencode");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
}

function defaultDataDir(): string {
  if (process.env.OPENCODE_DATA_DIR) return path.resolve(process.env.OPENCODE_DATA_DIR);

  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "opencode");
  }

  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProjectRoot(input: PluginInput): string {
  return path.resolve(input.project?.root ?? input.worktree ?? input.directory ?? process.cwd());
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function stripJsonComments(content: string): string {
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

function stripTrailingCommas(content: string): string {
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

function parseJsonConfig(content: string): Record<string, unknown> {
  return JSON.parse(stripTrailingCommas(stripJsonComments(content.replace(/^\uFEFF/, "")))) as Record<string, unknown>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveOpenCodeConfigPath(configDir?: string): Promise<string> {
  const directory = defaultConfigDir(configDir);
  const jsonPath = path.join(directory, "opencode.json");
  const jsoncPath = path.join(directory, "opencode.jsonc");

  if (await fileExists(jsonPath)) return jsonPath;
  if (await fileExists(jsoncPath)) return jsoncPath;
  return jsonPath;
}

function isBoundedLitePluginSpec(spec: unknown): boolean {
  const value = Array.isArray(spec) ? spec[0] : spec;
  return typeof value === "string" && value.includes(PLUGIN_FILE);
}

function readBoundedLitePluginOptions(config: Record<string, unknown>): Record<string, unknown> {
  const rawPlugins = Array.isArray(config["plugin"])
    ? config["plugin"]
    : config["plugin"]
      ? [config["plugin"]]
      : [];

  for (const spec of rawPlugins) {
    if (!isBoundedLitePluginSpec(spec)) continue;
    if (Array.isArray(spec) && isRecord(spec[1])) return spec[1];
  }

  return {};
}

function configuredTaskLeadProfiles(
  config: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Record<string, unknown> {
  const pluginOptions = readBoundedLitePluginOptions(config);
  if (isRecord(pluginOptions["taskLeadProfiles"])) return normalizeTaskLeadProfilesConfig(pluginOptions["taskLeadProfiles"]);
  if (isRecord(options.taskLeadProfiles)) return normalizeTaskLeadProfilesConfig(options.taskLeadProfiles);
  return isRecord(config["taskLeadProfiles"]) ? normalizeTaskLeadProfilesConfig(config["taskLeadProfiles"]) : {};
}

function withConfiguredTaskLeadProfiles(
  config: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Record<string, unknown> {
  return {
    ...config,
    taskLeadProfiles: configuredTaskLeadProfiles(config, options),
  };
}

function updateBoundedLitePluginOptions(
  config: Record<string, unknown>,
  updater: (pluginOptions: Record<string, unknown>) => Record<string, unknown>,
): void {
  const rawPlugins = Array.isArray(config["plugin"])
    ? config["plugin"]
    : config["plugin"]
      ? [config["plugin"]]
      : [];
  let updated = false;

  const plugins = rawPlugins.map((spec) => {
    if (!isBoundedLitePluginSpec(spec)) return spec;

    if (Array.isArray(spec)) {
      const next = [...spec];
      const existingOptions = isRecord(spec[1]) ? spec[1] : {};
      next[1] = updater(existingOptions);
      updated = true;
      return next;
    }

    updated = true;
    return [spec, updater({})];
  });

  if (updated) config["plugin"] = plugins;
}

function writeTaskLeadProfilesToPluginOptions(
  config: Record<string, unknown>,
  taskLeadProfiles: Record<string, unknown>,
): void {
  updateBoundedLitePluginOptions(config, (pluginOptions) => ({
    ...pluginOptions,
    taskLeadProfiles: normalizeTaskLeadProfilesConfig(taskLeadProfiles),
  }));
  delete config["taskLeadProfiles"];
}

function normalizeTaskLeadProfilesConfig(
  taskLeadProfiles: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [profileName, rawProfile] of Object.entries(taskLeadProfiles)) {
    if (!isKnownTaskLeadProfile(profileName)) continue;

    if (typeof rawProfile === "string" && rawProfile.trim() !== "") {
      normalized[profileName] = { model: rawProfile.trim() };
      continue;
    }

    if (!isRecord(rawProfile)) continue;

    const model = readString(rawProfile["model"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    const attributes = readStringArray(rawProfile["attributes"]);

    normalized[profileName] = {
      ...(model ? { model } : {}),
      ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
      ...(attributes.length > 0 ? { attributes } : {}),
    };
  }

  return normalized;
}

function taskLeadProfilesToDispatch(
  taskLeadProfiles: Record<string, unknown>,
): Partial<TaskDispatchConfig> {
  const profileModelMap: Record<string, string> = {};
  const profileFallbackModelMap: Record<string, string[]> = {};
  const attributeProfileMap: Record<string, string> = {};

  for (const [profileName, rawProfile] of Object.entries(taskLeadProfiles)) {
    if (!isRecord(rawProfile)) continue;

    const model = readString(rawProfile["model"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    const attributes = readStringArray(rawProfile["attributes"]);

    if (model) profileModelMap[profileName] = model;
    if (fallbackModels.length > 0) profileFallbackModelMap[profileName] = fallbackModels;

    for (const attribute of attributes) {
      attributeProfileMap[attribute] = profileName;
    }
  }

  return {
    ...(Object.keys(profileModelMap).length > 0 ? { profileModelMap } : {}),
    ...(Object.keys(profileFallbackModelMap).length > 0 ? { profileFallbackModelMap } : {}),
    ...(Object.keys(attributeProfileMap).length > 0 ? { attributeProfileMap } : {}),
  };
}

function mergeTaskDispatchWithConfiguredProfiles(
  dispatch: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Partial<TaskDispatchConfig> {
  const profileDispatch = taskLeadProfilesToDispatch(options.taskLeadProfiles ?? {});
  const inputDispatch = dispatch as Partial<TaskDispatchConfig>;

  return {
    ...profileDispatch,
    ...inputDispatch,
    profileModelMap: {
      ...(profileDispatch.profileModelMap ?? {}),
      ...(isRecord(inputDispatch.profileModelMap) ? inputDispatch.profileModelMap : {}),
    },
    profileFallbackModelMap: {
      ...(profileDispatch.profileFallbackModelMap ?? {}),
      ...(isRecord(inputDispatch.profileFallbackModelMap) ? inputDispatch.profileFallbackModelMap : {}),
    },
    attributeProfileMap: {
      ...(profileDispatch.attributeProfileMap ?? {}),
      ...(isRecord(inputDispatch.attributeProfileMap) ? inputDispatch.attributeProfileMap : {}),
    },
  };
}

async function readOpenCodeConfig(configDir?: string): Promise<Record<string, unknown>> {
  const configPath = await resolveOpenCodeConfigPath(configDir);
  const content = await readFile(configPath, "utf8");
  return parseJsonConfig(content);
}

async function readOpenCodeAuthProviderIds(): Promise<string[]> {
  try {
    const content = await readFile(path.join(defaultDataDir(), "auth.json"), "utf8");
    const auth = JSON.parse(content) as unknown;
    return isRecord(auth) ? Object.keys(auth) : [];
  } catch {
    return [];
  }
}

async function writeOpenCodeConfig(config: Record<string, unknown>, configDir?: string): Promise<string> {
  const configPath = await resolveOpenCodeConfigPath(configDir);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(`${configPath}.bak`, `${JSON.stringify(await readOpenCodeConfig(configDir), null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function resolveLiteConfigPath(configDir?: string): string {
  return path.join(defaultConfigDir(configDir), LITE_CONFIG_FILE);
}

async function readLiteConfigFile(configDir?: string, opencodeConfig?: Record<string, unknown>): Promise<LiteOpenAgentConfig> {
  try {
    const content = await readFile(resolveLiteConfigPath(configDir), "utf8");
    return migrateLiteConfigFromOpenCodeConfig(opencodeConfig ?? {}, readLiteConfig(parseJsonConfig(content)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    return migrateLiteConfigFromOpenCodeConfig(opencodeConfig ?? {}, createDefaultLiteConfig());
  }
}

async function writeLiteConfigFile(liteConfig: LiteOpenAgentConfig, configDir?: string): Promise<string> {
  const liteConfigPath = resolveLiteConfigPath(configDir);
  await mkdir(path.dirname(liteConfigPath), { recursive: true });
  try {
    await writeFile(`${liteConfigPath}.bak`, await readFile(liteConfigPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    await writeFile(`${liteConfigPath}.bak`, `${JSON.stringify(createDefaultLiteConfig(), null, 2)}\n`);
  }
  await writeFile(liteConfigPath, `${JSON.stringify(liteConfig, null, 2)}\n`);
  return liteConfigPath;
}

async function updateGeneratedAgentMarkdownFiles(
  liteConfig: LiteOpenAgentConfig,
  models: ReturnType<typeof listProviderModels>,
  configDir?: string,
): Promise<string[]> {
  const directory = defaultConfigDir(configDir);
  const agentsDir = path.join(directory, "agents");
  await mkdir(agentsDir, { recursive: true });
  const updated: string[] = [];

  for (const role of ROLE_CONTRACTS) {
    const filePath = path.join(agentsDir, `${role.name}.md`);
    let content = `---\nmode: ${role.opencodeMode}\ndescription: ${JSON.stringify(role.name)}\n---\n\n# ${role.name}\n`;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    const model = liteConfig.roleModels[role.name];
    const modelInfo = model ? models.find((item) => item.id === model) ?? model : undefined;
    const effectiveReasoning = resolveSupportedReasoningEffort({
      ...(modelInfo ? { model: modelInfo } : {}),
      ...(liteConfig.roleReasoningEffort[role.name] ? { requested: liteConfig.roleReasoningEffort[role.name] } : {}),
      fallback: defaultRoleReasoningEffort(role.name),
    });
    const nextContent = upsertMarkdownFrontmatter(content, {
      ...(model ? { model } : {}),
      ...(effectiveReasoning ? { reasoningEffort: effectiveReasoning } : {}),
    });
    await writeFile(`${filePath}.bak`, content);
    await writeFile(filePath, nextContent);
    updated.push(filePath);
  }

  return updated;
}

function upsertMarkdownFrontmatter(content: string, updates: Record<string, string>): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = match ? content.slice(match[0].length) : content;
  const frontmatter = match?.[1] ?? "";
  const lines = frontmatter.split("\n").filter((line) => {
    const key = line.split(":", 1)[0]?.trim();
    return key !== "model" && key !== "reasoningEffort";
  });
  for (const [key, value] of Object.entries(updates)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function yamlScalar(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : JSON.stringify(value);
}

async function listRuntimeProviderModels(input: PluginInput): Promise<ReturnType<typeof listProviderModels>> {
  const client = input.client as {
    config?: {
      providers?: (parameters?: Record<string, unknown>) => Promise<unknown>;
    };
    provider?: {
      list?: (parameters?: Record<string, unknown>) => Promise<unknown>;
    };
  } | undefined;
  const query = { directory: input.directory, workspace: input.worktree };

  try {
    const response = await client?.config?.providers?.(query);
    const models = listProviderModelsFromResponse(response);
    if (models.length > 0) return models;
  } catch {
    // Fall back to provider.list and finally JSON config below.
  }

  try {
    const response = await client?.provider?.list?.(query);
    return listProviderModelsFromResponse(response);
  } catch {
    return [];
  }
}

async function listModelsDevProviderModels(providerIds: readonly string[]): Promise<ReturnType<typeof listProviderModels>> {
  if (providerIds.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch("https://models.dev/api.json", { signal: controller.signal });
    if (!response.ok) return [];

    return listProviderModelsFromModelsDevResponse(await response.json(), providerIds);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function readModelPoolPolicy(args: unknown): ModelPoolPolicy {
  const request = isRecord(args) ? args : {};
  const policy = isRecord(request["policy"]) ? request["policy"] : {};
  const sourceValue = typeof policy["source"] === "string"
    ? policy["source"]
    : typeof request["source"] === "string"
      ? request["source"]
      : undefined;
  const source = isModelSourceFilter(sourceValue) ? sourceValue : undefined;
  const providerPreference = readStringArray(policy["providerPreference"] ?? request["providerPreference"]);
  const familyPreference = readFamilyArray(policy["familyPreference"] ?? request["familyPreference"]);
  const allowCodexBackend = typeof policy["allowCodexBackend"] === "boolean"
    ? policy["allowCodexBackend"]
    : typeof request["allowCodexBackend"] === "boolean"
      ? request["allowCodexBackend"]
      : undefined;

  return {
    ...(source ? { source } : {}),
    ...(providerPreference.length > 0 ? { providerPreference } : {}),
    ...(familyPreference.length > 0 ? { familyPreference } : {}),
    ...(typeof allowCodexBackend === "boolean" ? { allowCodexBackend } : {}),
  };
}

function readFamilyArray(value: unknown): ModelFamily[] {
  const valid = new Set<ModelFamily>(["gpt", "claude", "gemini", "kimi", "minimax", "glm", "codex", "other"]);
  return readStringArray(value).filter((item): item is ModelFamily => valid.has(item as ModelFamily));
}

function readRoleModelAssignments(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};

  for (const [role, assignment] of Object.entries(value)) {
    if (typeof assignment === "string") {
      result[role] = assignment;
      continue;
    }

    if (isRecord(assignment) && typeof assignment["model"] === "string") {
      result[role] = assignment["model"];
    }
  }

  return result;
}

function readEmbeddedReasoningEffortAssignments(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};

  for (const [role, assignment] of Object.entries(value)) {
    if (isRecord(assignment) && typeof assignment["reasoningEffort"] === "string") {
      result[role] = assignment["reasoningEffort"];
    }
  }

  return result;
}

function mergeRecordAssignments(...items: unknown[]): Record<string, unknown> {
  return items.reduce<Record<string, unknown>>((merged, item) => {
    if (!isRecord(item)) return merged;
    return { ...merged, ...item };
  }, {});
}

function isModelSourceFilter(value: unknown): value is ModelProviderSource | "all" {
  return (
    value === "opencode-subscription" ||
    value === "api-provider" ||
    value === "gateway" ||
    value === "unknown" ||
    value === "all"
  );
}

type ModelConfigAction = "import" | "list" | "auto" | "apply";

interface ModelConfigRequest {
  action: ModelConfigAction;
  assignments?: Record<string, unknown>;
  reasoningEffortAssignments?: Record<string, unknown>;
  taskLeadProfileAssignments?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  source?: string;
  providerPreference?: string[];
  familyPreference?: string[];
  allowCodexBackend?: boolean;
}

interface ModelConfigValidationError {
  field: string;
  code: string;
  message: string;
}

interface ModelConfigResponse {
  ok: boolean;
  action: ModelConfigAction;
  applied: boolean;
  changed_keys: string[];
  validation_errors?: ModelConfigValidationError[];
  warnings?: string[];
  available_models?: Array<{ id: string; provider?: string; label?: string }>;
  role_assignments?: Record<string, string>;
  profile_assignments?: Record<string, string>;
  reasoning_effort_assignments?: Record<string, "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
  recommendations?: {
    roles?: Record<string, string>;
    taskLeadProfiles?: Record<string, string>;
    reasoningEffort?: Record<string, "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
  };
  report?: string;
}

type PlanArtifactRequest =
  | {
    action: "write";
    operation: "create" | "update";
    title?: string;
    markdown?: string;
    sessionKey: string;
    sessionStartedAt: string;
    filenameHint?: string;
    generatedBy: string;
    planId?: string;
    status?: "draft" | "reviewed" | "blocked";
    maturityLevel?: string;
    targetPlanRef?: string;
    sourceSessionKey?: string;
    sourcePlanRef?: string;
    replacesSessionKey?: string;
    replacesPlanRef?: string;
  }
  | {
    action: "rebuild";
    generatedBy?: string;
    reason?: string;
  };

function toToolOutput(value: unknown): { output: string; metadata: Record<string, unknown> } {
  return {
    output: typeof value === "string" ? value : JSON.stringify(value),
    metadata: {},
  };
}

function inferModelConfigAction(payload: unknown): ModelConfigAction {
  if (!isRecord(payload)) return "list";
  const action = payload["action"];
  if (action === "import" || action === "list" || action === "auto" || action === "apply") {
    return action;
  }
  return "list";
}

function toAvailableModels(models: ReturnType<typeof importModelPool>): Array<{ id: string; provider?: string; label?: string }> {
  return models.map((model) => ({
    id: model.id,
    ...(model.provider ? { provider: model.provider } : {}),
    ...(model.name ? { label: model.name } : {}),
  }));
}

function collectChangedKeys(input: {
  roleChanged: Array<{ role: string }>;
  profileChanged: Array<{ profile: string }>;
  reasoningChanged: Array<{ role: string }>;
}): string[] {
  return [
    ...input.roleChanged.map((item) => `assignments.${item.role}`),
    ...input.profileChanged.map((item) => `taskLeadProfileAssignments.${item.profile}`),
    ...input.reasoningChanged.map((item) => `reasoningEffortAssignments.${item.role}`),
  ];
}

function parseModelConfigError(error: unknown, action: ModelConfigAction): ModelConfigResponse {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^(MODELCFG_ERR_[A-Z_]+):\s*(.*)$/);
  if (!match) {
    return {
      ok: false,
      action,
      applied: false,
      changed_keys: [],
      validation_errors: [{
        field: "runtime",
        code: "MODELCFG_ERR_RUNTIME",
        message,
      }],
    };
  }

  const code = match[1] ?? "MODELCFG_ERR_INVALID_PAYLOAD";
  const details = match[2] ?? message;
  const field = code === "MODELCFG_ERR_MISSING_ACTION" || code === "MODELCFG_ERR_UNKNOWN_ACTION"
    ? "action"
    : code === "MODELCFG_ERR_UNKNOWN_FIELD"
      ? "payload"
      : "request";

  return {
    ok: false,
    action,
    applied: false,
    changed_keys: [],
    validation_errors: [{ field, code, message: details }],
  };
}

function parsePlanArtifactError(error: unknown, action: "write" | "rebuild" = "write"): {
  ok: false;
  action: "write" | "rebuild";
  applied: false;
  code: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^(PLANART_ERR_[A-Z_]+):\s*(.*)$/);

  return {
    ok: false,
    action,
    applied: false,
    code: match?.[1] ?? "PLANART_ERR_RUNTIME",
    message: match?.[2] ?? message,
  };
}

function parsePlanArtifactRequest(payload: unknown): PlanArtifactRequest {
  if (!isRecord(payload)) {
    throw new Error("PLANART_ERR_INVALID_PAYLOAD: bounded_lite_plan_artifact payload must be an object.");
  }

  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);

  const allowedFields = new Set([
    "action",
    "operation",
    "reason",
    "title",
    "markdown",
    "content",
    "sessionKey",
    "session_key",
    "sessionStartedAt",
    "session_started_at",
    "filenameHint",
    "filename_hint",
    "generatedBy",
    "generated_by",
    "planId",
    "plan_id",
    "sourceSessionKey",
    "source_session_key",
    "sourcePlanRef",
    "source_plan_ref",
    "replacesSessionKey",
    "replaces_session_key",
    "replacesPlanRef",
    "replaces_plan_ref",
    "status",
    "maturityLevel",
    "maturity_level",
    "targetPlanRef",
    "target_plan_ref",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new Error(`PLANART_ERR_UNKNOWN_FIELD: unknown field "${key}".`);
    }
  }

  const action = readString(payload["action"]);
  if (!action) {
    throw new Error("PLANART_ERR_MISSING_ACTION: bounded_lite_plan_artifact requires action.");
  }
  if (action !== "write" && action !== "rebuild") {
    throw new Error("PLANART_ERR_UNKNOWN_ACTION: action must be write or rebuild.");
  }

  if (action === "rebuild") {
    const hasAny = (...keys: string[]): boolean => keys.some((key) => hasOwn(key));
    const rebuildGeneratedBy = readString(payload["generatedBy"]) ?? readString(payload["generated_by"]);
    const rebuildReason = readString(payload["reason"]);

    if (hasAny("operation")) {
      throw new Error("PLANART_ERR_REBUILD_OPERATION_FORBIDDEN: rebuild does not accept operation.");
    }
    if (hasAny("targetPlanRef", "target_plan_ref")) {
      throw new Error("PLANART_ERR_REBUILD_TARGET_FORBIDDEN: rebuild does not accept targetPlanRef.");
    }
    if (hasAny("title", "markdown", "content")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept title or markdown fields.");
    }
    if (hasAny("sessionKey", "session_key")) {
      throw new Error("PLANART_ERR_REBUILD_SESSION_FORBIDDEN: rebuild does not accept sessionKey.");
    }
    if (hasAny("sessionStartedAt", "session_started_at")) {
      throw new Error("PLANART_ERR_REBUILD_SESSION_FORBIDDEN: rebuild does not accept sessionStartedAt.");
    }
    if (hasAny("filenameHint", "filename_hint")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept filenameHint.");
    }
    if (hasAny("planId", "plan_id")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept planId.");
    }
    if (hasAny("status")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept status.");
    }
    if (hasAny("maturityLevel", "maturity_level")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept maturityLevel.");
    }

    return {
      action: "rebuild",
      ...(rebuildGeneratedBy ? { generatedBy: rebuildGeneratedBy } : {}),
      ...(rebuildReason ? { reason: rebuildReason } : {}),
    };
  }

  const title = readString(payload["title"]);
  const markdown = readString(payload["markdown"]) ?? readString(payload["content"]);
  const operation = readString(payload["operation"]) ?? "create";
  const sessionKey = readString(payload["sessionKey"]) ?? readString(payload["session_key"]);
  const sessionStartedAt = readString(payload["sessionStartedAt"]) ?? readString(payload["session_started_at"]);
  const filenameHint = readString(payload["filenameHint"]) ?? readString(payload["filename_hint"]);
  const generatedBy = readString(payload["generatedBy"]) ?? readString(payload["generated_by"]);
  const planId = readString(payload["planId"]) ?? readString(payload["plan_id"]);
  const sourceSessionKey = readString(payload["sourceSessionKey"]) ?? readString(payload["source_session_key"]);
  const sourcePlanRef = readString(payload["sourcePlanRef"]) ?? readString(payload["source_plan_ref"]);
  const replacesSessionKey = readString(payload["replacesSessionKey"]) ?? readString(payload["replaces_session_key"]);
  const replacesPlanRef = readString(payload["replacesPlanRef"]) ?? readString(payload["replaces_plan_ref"]);
  const maturityLevel = readString(payload["maturityLevel"]) ?? readString(payload["maturity_level"]);
  const targetPlanRef = readString(payload["targetPlanRef"]) ?? readString(payload["target_plan_ref"]);

  if (operation !== "create" && operation !== "update") {
    throw new Error("PLANART_ERR_UNSUPPORTED_OPERATION: operation must be create or update.");
  }

  if (!sessionKey) throw new Error("PLANART_ERR_MISSING_SESSION_KEY: sessionKey is required.");
  if (!sessionStartedAt) throw new Error("PLANART_ERR_MISSING_SESSION_STARTED_AT: sessionStartedAt is required.");
  if (!generatedBy) throw new Error("PLANART_ERR_MISSING_GENERATED_BY: generatedBy is required.");

  const status = readString(payload["status"]);
  if (status && status !== "draft" && status !== "reviewed" && status !== "blocked") {
    throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: supported statuses are draft, reviewed, and blocked.");
  }

  if (operation === "create") {
    if (!title) throw new Error("PLANART_ERR_MISSING_TITLE: title is required.");
    if (!markdown) throw new Error("PLANART_ERR_MISSING_MARKDOWN: markdown is required.");
    if (!filenameHint) throw new Error("PLANART_ERR_MISSING_FILENAME_HINT: filenameHint is required.");
    if (sourceSessionKey && !sourcePlanRef) {
      throw new Error("PLANART_ERR_SOURCE_PLAN_REF_REQUIRED: sourceSessionKey requires sourcePlanRef.");
    }
    if (replacesSessionKey && !replacesPlanRef) {
      throw new Error("PLANART_ERR_REPLACEMENT_TARGET_MISSING: replacesSessionKey requires replacesPlanRef.");
    }
    if (status && status !== "draft" && status !== "reviewed" && status !== "blocked") {
      throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: create supports draft, reviewed, or blocked.");
    }
  }

  if (operation === "update") {
    if (sourceSessionKey || sourcePlanRef) {
      throw new Error("PLANART_ERR_UPDATE_SOURCE_FORBIDDEN: update does not accept sourcePlanRef or sourceSessionKey.");
    }
    if (replacesSessionKey || replacesPlanRef) {
      throw new Error("PLANART_ERR_UPDATE_REPLACEMENT_FORBIDDEN: update does not accept replacesPlanRef or replacesSessionKey.");
    }
    if (!markdown && !status) {
      throw new Error("PLANART_ERR_MISSING_UPDATE_PAYLOAD: update requires markdown/content or status.");
    }
  }

  return {
    action: "write",
    operation,
    sessionKey,
    sessionStartedAt,
    generatedBy,
    ...(title ? { title } : {}),
    ...(markdown ? { markdown } : {}),
    ...(filenameHint ? { filenameHint } : {}),
    ...(planId ? { planId } : {}),
    ...(sourceSessionKey ? { sourceSessionKey } : {}),
    ...(sourcePlanRef ? { sourcePlanRef } : {}),
    ...(replacesSessionKey ? { replacesSessionKey } : {}),
    ...(replacesPlanRef ? { replacesPlanRef } : {}),
    ...(status === "draft" || status === "reviewed" || status === "blocked" ? { status } : {}),
    ...(maturityLevel ? { maturityLevel } : {}),
    ...(targetPlanRef ? { targetPlanRef } : {}),
  };
}

function parseModelConfigRequest(payload: unknown): ModelConfigRequest {
  if (!isRecord(payload)) {
    throw new Error("MODELCFG_ERR_INVALID_PAYLOAD: bounded_lite_model_config payload must be an object.");
  }

  const allowedFields = new Set([
    "action",
    "assignments",
    "reasoningEffortAssignments",
    "taskLeadProfileAssignments",
    "policy",
    "source",
    "providerPreference",
    "familyPreference",
    "allowCodexBackend",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new Error(`MODELCFG_ERR_UNKNOWN_FIELD: unknown field \"${key}\".`);
    }
  }

  if (typeof payload["action"] !== "string" || payload["action"].trim() === "") {
    throw new Error("MODELCFG_ERR_MISSING_ACTION: bounded_lite_model_config requires action.");
  }

  const action = payload["action"];
  if (action !== "import" && action !== "list" && action !== "auto" && action !== "apply") {
    throw new Error("MODELCFG_ERR_UNKNOWN_ACTION: action must be import, list, auto, or apply.");
  }

  return {
    action,
    ...(isRecord(payload["assignments"]) ? { assignments: payload["assignments"] } : {}),
    ...(isRecord(payload["reasoningEffortAssignments"])
      ? { reasoningEffortAssignments: payload["reasoningEffortAssignments"] }
      : {}),
    ...(isRecord(payload["taskLeadProfileAssignments"])
      ? { taskLeadProfileAssignments: payload["taskLeadProfileAssignments"] }
      : {}),
    ...(isRecord(payload["policy"]) ? { policy: payload["policy"] } : {}),
    ...(typeof payload["source"] === "string" ? { source: payload["source"] } : {}),
    ...(Array.isArray(payload["providerPreference"])
      ? { providerPreference: readStringArray(payload["providerPreference"]) }
      : {}),
    ...(Array.isArray(payload["familyPreference"])
      ? { familyPreference: readStringArray(payload["familyPreference"]) }
      : {}),
    ...(typeof payload["allowCodexBackend"] === "boolean"
      ? { allowCodexBackend: payload["allowCodexBackend"] }
      : {}),
  };
}

export function createBoundedLitePlugin(
  _input: PluginInput,
  rawOptions?: Record<string, unknown>,
): PluginHooks {
  const options = normalizePluginOptions(rawOptions as BoundedLitePluginOptions | undefined);
  const runtimeProfile = createRuntimeProfile({
    pluginEnabled: options.mode === "full",
    hooksEnabled: options.enableHooks,
    backgroundEnabled: options.enableBackground,
    bundledMcpEnabled: options.enableBundledMcp,
  });
  const background = new BackgroundCoordinator();
  let planArtifactSelfCheckRan = false;
  let planArtifactSelfCheckFailure: { code: string; message: string } | undefined;
  let planArtifactSelfCheckPromise: Promise<void> | undefined;

  return {
    config() {
      if (options.maxChildDepth > MAX_CHILD_ORCHESTRATOR_DEPTH) {
        throw new Error(
          `maxChildDepth must stay <= ${MAX_CHILD_ORCHESTRATOR_DEPTH} to preserve bounded orchestration.`,
        );
      }
    },
    tool: {
      bounded_lite_route: {
        description: "Resolve a bounded internal routing category to its target role.",
        args: {},
        async execute(args) {
          const category = args["category"];

          if (!isRoutingCategory(category)) {
            throw new Error("Route tool requires a valid bounded routing category.");
          }

          return toToolOutput(resolveCategoryRoute(category));
        },
      },
      bounded_lite_plan_dag: {
        description: "Validate a required plan.subtasks payload and return bounded DAG waves plus dispatch profiles.",
        args: {},
        async execute(args) {
          const payload = args["payload"];
          const dispatch = mergeTaskDispatchWithConfiguredProfiles(
            isRecord(args["dispatch"]) ? args["dispatch"] : {},
            options,
          );

          return toToolOutput(buildTaskDAG(payload, dispatch as Partial<TaskDispatchConfig>));
        },
      },
      bounded_lite_plan_readiness: {
        description: "Validate a Plan Builder artifact against readiness gates before Command Lead dispatches execution.",
        args: {},
        async execute(args) {
          const payload = args["payload"];
          const dispatch = mergeTaskDispatchWithConfiguredProfiles(
            isRecord(args["dispatch"]) ? args["dispatch"] : {},
            options,
          );

          return toToolOutput(validatePlanReadiness(payload, dispatch as Partial<TaskDispatchConfig>));
        },
      },
      bounded_lite_plan_artifact: {
        description: "Persist a Command Lead-approved openplan artifact with create/update semantics, or rebuild openplan/index.jsonl from plan frontmatter.",
        args: {},
        async execute(args, context) {
          const requestedAction = readString(args["action"]) === "rebuild" ? "rebuild" : "write";

          try {
            if (!planArtifactSelfCheckRan) {
              if (!planArtifactSelfCheckPromise) {
                planArtifactSelfCheckPromise = (async () => {
                  try {
                    await ensureOpenPlanIndexHealthyOnce({
                      ...(options.configDir ? { configDir: options.configDir } : {}),
                    });
                  } catch (error) {
                    const parsed = parsePlanArtifactError(error);
                    planArtifactSelfCheckFailure = {
                      code: parsed.code,
                      message: `index self-check repair failed: ${parsed.message}; requires follow-up repair`,
                    };
                  } finally {
                    planArtifactSelfCheckRan = true;
                  }
                })();
              }

              await planArtifactSelfCheckPromise;
            }

            const request = parsePlanArtifactRequest(args);
            if (request.action === "rebuild") {
              const rebuilt = await rebuildOpenPlanIndex({
                ...(options.configDir ? { configDir: options.configDir } : {}),
                mode: "manual-rebuild",
                ...(request.generatedBy ? { generatedBy: request.generatedBy } : {}),
                ...(request.reason ? { reason: request.reason } : {}),
              });

              planArtifactSelfCheckFailure = undefined;
              return toToolOutput({
                ok: true,
                action: request.action,
                applied: true,
                indexPath: rebuilt.indexPath,
                scannedFileCount: rebuilt.scannedFileCount,
                rebuiltRecordCount: rebuilt.rebuiltRecordCount,
                status: rebuilt.status,
                mode: rebuilt.mode,
              });
            }

            if (planArtifactSelfCheckFailure) {
              return toToolOutput({
                ok: false,
                action: request.action,
                applied: false,
                code: planArtifactSelfCheckFailure.code,
                message: planArtifactSelfCheckFailure.message,
              });
            }

            const result = await writePlanArtifact({
              projectRoot: resolveProjectRoot(context),
              action: request.action,
              operation: request.operation,
              sessionKey: request.sessionKey,
              sessionStartedAt: request.sessionStartedAt,
              generatedBy: request.generatedBy,
              ...(request.title ? { title: request.title } : {}),
              ...(request.markdown ? { markdown: request.markdown } : {}),
              ...(request.filenameHint ? { filenameHint: request.filenameHint } : {}),
              ...(request.planId ? { planId: request.planId } : {}),
              ...(request.sourceSessionKey ? { sourceSessionKey: request.sourceSessionKey } : {}),
              ...(request.sourcePlanRef ? { sourcePlanRef: request.sourcePlanRef } : {}),
              ...(request.replacesSessionKey ? { replacesSessionKey: request.replacesSessionKey } : {}),
              ...(request.replacesPlanRef ? { replacesPlanRef: request.replacesPlanRef } : {}),
              ...(request.status ? { status: request.status } : {}),
              ...(request.maturityLevel ? { maturityLevel: request.maturityLevel } : {}),
              ...(request.targetPlanRef ? { targetPlanRef: request.targetPlanRef } : {}),
              ...(options.configDir ? { configDir: options.configDir } : {}),
            });

            return toToolOutput({
              ok: true,
              action: request.action,
              applied: true,
              planId: result.planId,
              path: result.path,
              indexPath: result.indexPath,
              sessionKey: result.sessionKey,
              bytes: result.bytes,
              status: result.status,
              operation: result.operation,
              rebuildTriggered: result.rebuildTriggered,
            });
          } catch (error) {
            return toToolOutput(parsePlanArtifactError(error, requestedAction));
          }
        },
      },
      bounded_lite_background: {
        description: "List currently tracked background tasks from the bounded coordinator.",
        args: {},
        async execute() {
          return toToolOutput(background.list());
        },
      },
      bounded_lite_runtime_profile: {
        description: "Report the current runtime profile without creating a second control plane.",
        args: {},
        async execute() {
          return toToolOutput(runtimeProfile);
        },
      },
      bounded_lite_model_config: {
        description: `Import, list, recommend, or update per-role and Task Lead profile OpenCode models for Oh My Lite OpenAgent.

Actions:
	- import: Import all available OpenCode model providers by default. Call with { "action": "import" }.
- list: Show current role model assignments and available provider models. Call with { "action": "list" }.
- auto: Show the imported model pool first, then recommend role and Task Lead profile model assignments from that pool based on capability needs. This does not write config. Call with { "action": "auto" }.
- apply: Manually assign specific models, reasoning effort, or profile models. Call with { "action": "apply", "assignments": { "role-name": "provider/model-id" }, "reasoningEffortAssignments": { "command-lead": "high" }, "taskLeadProfileAssignments": { "code": "provider/model-id" } }.

Policy:
	- source and providerPreference are optional narrowing filters; by default the imported pool includes every discovered provider.
- allowCodexBackend defaults to false.
- familyPreference can limit the imported pool, for example { "familyPreference": ["gpt"] } for GPT-family subscription models.
- reasoningEffortAssignments supports minimal, low, medium, or high and writes agent.<role>.reasoningEffort for providers/models that support that option.

Role capability summary:
- command-lead (orchestration): needs strongest reasoning
- plan-builder (planning): needs strong reasoning + structured output
- deep-plan-builder (advisory-planning): detailed plans for lower-strength executors, has mandatory plan review
- task-lead (execution): mid-tier models sufficient
- explore (fast-retrieval): fast, cheap models preferred
- librarian (fast-retrieval): fast, cheap models preferred
- plan-review (critical-review): needs strongest reasoning to catch errors
- result-review (critical-review): needs strongest reasoning to verify completeness

Task Lead profile summary:
- quick: fast low-risk execution
- code: bounded implementation and tests
- research/docs: repository or external API understanding
- writing: docs and prose
- visual/multimodal: UI or visual verification
- deep/large-context: difficult or large-context execution
- risk-high/security/migration: high-risk changes requiring stronger reasoning

AI selection rule:
- Only choose model IDs returned by action=import or the imported pool used by action=auto.
- For reasoning effort, prefer the JSON returned by action=auto, then let the user adjust low/medium/high per role before applying.
- After action=auto, ask the user whether they want to modify the recommendations before calling action=apply.

If no provider models are found, tell the user to configure or connect OpenCode providers first.`,
        args: {
          action: tool.schema.enum(["import", "list", "auto", "apply"]),
          assignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          reasoningEffortAssignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          taskLeadProfileAssignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          policy: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          source: tool.schema.string().optional(),
          providerPreference: tool.schema.array(tool.schema.string()).optional(),
          familyPreference: tool.schema.array(tool.schema.string()).optional(),
          allowCodexBackend: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          const fallbackAction = inferModelConfigAction(args);

          try {
            const request = parseModelConfigRequest(args);
            const action = request.action;
            const config = await readOpenCodeConfig(options.configDir);
            const effectiveConfig = withConfiguredTaskLeadProfiles(config, options);
            const credentialProviderIds = await readOpenCodeAuthProviderIds();
            const runtimeModels = await listRuntimeProviderModels(context);
            const modelsDevModels = await listModelsDevProviderModels(credentialProviderIds);
            const credentialModels = listKnownModelsForCredentialProviders(
              credentialProviderIds,
            );
            const configModels = listProviderModels(effectiveConfig);
            const discoveredPool = buildDiscoveredModelPool({
              runtimeModels,
              connectedProviderIds: credentialProviderIds,
              modelsDevModels,
              credentialFallbackModels: credentialModels,
              configuredModels: configModels,
            });
            const models = discoveredPool.models;
            const inferredPolicy = inferModelPoolPolicy(effectiveConfig, readModelPoolPolicy(request));
            const poolPolicy = inferredPolicy.policy;
            const importedPool = importModelPool(models, poolPolicy);

            if (action === "import") {
              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(importedPool),
                report: [
                  inferredPolicy.reason,
                  "",
                  formatModelImportReport({
                    models: importedPool,
                    policy: poolPolicy,
                  }),
                ].join("\n"),
              } satisfies ModelConfigResponse);
            }

            if (action === "list") {
              const roleSummaries = summarizeRoleModels(effectiveConfig);
              const profileSummaries = summarizeTaskLeadProfileModels(effectiveConfig);
              const roleAssignments = Object.fromEntries(
                roleSummaries
                  .filter((role) => typeof role.effectiveModel === "string")
                  .map((role) => [role.role, role.effectiveModel as string]),
              );
              const profileAssignments = Object.fromEntries(
                profileSummaries
                  .filter((profile) => typeof profile.effectiveModel === "string")
                  .map((profile) => [profile.profile, profile.effectiveModel as string]),
              );

              const report = models.length === 0
                ? [
                  "Oh My Lite OpenAgent role model configuration",
                  "",
                  "Current role models:",
                  ...roleSummaries.map((role) => {
                    const source = role.inheritsGlobal ? "inherits global" : "configured";
                    return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
                  }),
                  "",
                  "Available provider models:",
                  "- <none found>",
                  "",
                  "No provider models were detected from either runtime or config.",
                ].join("\n")
                : formatModelConfigReport({
                  roles: roleSummaries,
                  taskLeadProfiles: profileSummaries,
                  models,
                });

              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(models),
                role_assignments: roleAssignments,
                profile_assignments: profileAssignments,
                report,
              } satisfies ModelConfigResponse);
            }

            if (action === "auto") {
              const autoResult = resolveAutoModels(importedPool, effectiveConfig);
              const profileAutoResult = resolveAutoTaskLeadProfileModels(importedPool);
              const reasoningEffortAssignments = resolveAutoReasoningEffortAssignments(autoResult.assignments);

              const report = importedPool.length === 0 && autoResult.resolved.length === 0 && profileAutoResult.resolved.length === 0
                ? [
                  "Oh My Lite OpenAgent auto model configuration",
                  "",
                  "No imported models found to recommend.",
                  "",
                  inferredPolicy.reason,
                  "",
                  formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                ].join("\n")
                : [
                  "Oh My Lite OpenAgent /agent-models one-stop discovery and recommendation",
                  "",
                  inferredPolicy.reason,
                  "",
                  "Available imported model pool (review before recommendations):",
                  formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                  "",
                  formatAutoModelReport(autoResult),
                  "",
                  formatTaskLeadProfileModelReport(profileAutoResult),
                ].join("\n");

              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(importedPool),
                recommendations: {
                  roles: autoResult.assignments,
                  taskLeadProfiles: profileAutoResult.assignments,
                  reasoningEffort: reasoningEffortAssignments,
                },
                role_assignments: autoResult.assignments,
                profile_assignments: profileAutoResult.assignments,
                reasoning_effort_assignments: reasoningEffortAssignments,
                report,
              } satisfies ModelConfigResponse);
            }

            if (action === "apply") {
              const assignments = request.assignments;
              const taskLeadProfileAssignments = request.taskLeadProfileAssignments;
              const roleModelAssignments = readRoleModelAssignments(assignments);
              const reasoningEffortAssignments = mergeRecordAssignments(
                readEmbeddedReasoningEffortAssignments(assignments),
                request.reasoningEffortAssignments,
              );

              const hasRoleAssignments = Object.keys(roleModelAssignments).length > 0;
              const hasReasoningAssignments = Object.keys(reasoningEffortAssignments).length > 0;
              const hasProfileAssignments = typeof taskLeadProfileAssignments === "object" &&
                taskLeadProfileAssignments !== null &&
                !Array.isArray(taskLeadProfileAssignments);

              if (!hasRoleAssignments && !hasProfileAssignments && !hasReasoningAssignments) {
                return toToolOutput({
                  ok: false,
                  action,
                  applied: false,
                  changed_keys: [],
                  validation_errors: [{
                    field: "apply",
                    code: "MODELCFG_ERR_INVALID_PAYLOAD",
                    message: "bounded_lite_model_config apply requires assignments, reasoningEffortAssignments, or taskLeadProfileAssignments.",
                  }],
                } satisfies ModelConfigResponse);
              }

              const hasAnyDiscoveredPoolSource =
                importedPool.length > 0 ||
                models.length > 0 ||
                runtimeModels.length > 0 ||
                modelsDevModels.length > 0 ||
                credentialModels.length > 0 ||
                configModels.length > 0;

              if ((hasRoleAssignments || hasProfileAssignments) && !hasAnyDiscoveredPoolSource) {
                return toToolOutput({
                  ok: false,
                  action,
                  applied: false,
                  changed_keys: [],
                  validation_errors: [{
                    field: "apply",
                    code: "MODELCFG_ERR_POOL_UNAVAILABLE",
                    message: "unable to build a model pool for apply.",
                  }],
                } satisfies ModelConfigResponse);
              }

              const result = hasRoleAssignments ? applyRoleModelConfig(
                config,
                roleModelAssignments,
                importedPool.map((model) => model.id),
                { allowUnavailableModels: true },
              ) : { changed: [], skipped: [], warnings: [] };
              const reasoningResult = hasReasoningAssignments ? applyRoleReasoningEffortConfig(
                config,
                reasoningEffortAssignments,
              ) : { changed: [], skipped: [] };
              const profileConfig = withConfiguredTaskLeadProfiles(config, options);
              const profileResult = hasProfileAssignments ? applyTaskLeadProfileModelConfig(
                profileConfig,
                taskLeadProfileAssignments as Record<string, unknown>,
                importedPool.map((model) => model.id),
                { allowUnavailableModels: true },
              ) : { changed: [], skipped: [], warnings: [] };
              if (hasProfileAssignments || isRecord(config["taskLeadProfiles"])) {
                const profiles = isRecord(profileConfig["taskLeadProfiles"])
                  ? profileConfig["taskLeadProfiles"]
                  : {};
                writeTaskLeadProfilesToPluginOptions(config, profiles);
              }
              const updatedEffectiveConfig = withConfiguredTaskLeadProfiles(config, {
                ...options,
                taskLeadProfiles: isRecord(profileConfig["taskLeadProfiles"])
                  ? profileConfig["taskLeadProfiles"]
                  : {},
              });
              const configPath = await writeOpenCodeConfig(config, options.configDir);
              const changedKeys = collectChangedKeys({
                roleChanged: result.changed,
                profileChanged: profileResult.changed,
                reasoningChanged: reasoningResult.changed,
              });

              const warnings = [
                ...result.warnings.map((item) => `${item.role}: ${item.warning}`),
                ...profileResult.warnings.map((item) => `${item.profile}: ${item.warning}`),
                ...result.skipped.map((item) => `${item.role}: ${item.reason}`),
                ...profileResult.skipped.map((item) => `${item.profile}: ${item.reason}`),
                ...reasoningResult.skipped.map((item) => `${item.role}: ${item.reason}`),
              ];

              return toToolOutput({
                ok: true,
                action,
                applied: changedKeys.length > 0,
                changed_keys: changedKeys,
                ...(warnings.length > 0 ? { warnings } : {}),
                available_models: toAvailableModels(importedPool),
                role_assignments: Object.fromEntries(
                  summarizeRoleModels(updatedEffectiveConfig)
                    .filter((role) => typeof role.effectiveModel === "string")
                    .map((role) => [role.role, role.effectiveModel as string]),
                ),
                profile_assignments: Object.fromEntries(
                  summarizeTaskLeadProfileModels(updatedEffectiveConfig)
                    .filter((profile) => typeof profile.effectiveModel === "string")
                    .map((profile) => [profile.profile, profile.effectiveModel as string]),
                ),
                reasoning_effort_assignments: Object.fromEntries(
                  summarizeRoleModels(updatedEffectiveConfig)
                    .filter((role) => typeof role.configuredReasoningEffort === "string")
                    .map((role) => [role.role, role.configuredReasoningEffort as "minimal" | "low" | "medium" | "high"]),
                ),
                report: [
                  formatModelConfigReport({
                    roles: summarizeRoleModels(updatedEffectiveConfig),
                    taskLeadProfiles: summarizeTaskLeadProfileModels(updatedEffectiveConfig),
                    models: importedPool,
                    changed: result.changed,
                    skipped: result.skipped,
                    warnings: result.warnings,
                    profileChanged: profileResult.changed,
                    profileSkipped: profileResult.skipped,
                    profileWarnings: profileResult.warnings,
                    reasoningChanged: reasoningResult.changed,
                    reasoningSkipped: reasoningResult.skipped,
                  }),
                  "",
                  `Updated ${configPath}. Restart OpenCode or start a new session if the active TUI keeps old model state.`,
                ].join("\n"),
              } satisfies ModelConfigResponse);
            }

            throw new Error("MODELCFG_ERR_UNKNOWN_ACTION: action must be import, list, auto, or apply.");
          } catch (error) {
            return toToolOutput(parseModelConfigError(error, fallbackAction));
          }
        },
      },
    },
    "permission.ask"(input, output) {
      if (input.tool.startsWith("bounded_lite_")) {
        output.status = "allow";
      }
    },
    "tool.execute.before"(input, output) {
      if (input.tool === "task" && isRecord(output.args)) {
        const command = readString(output.args["command"]);
        const prompt = readString(output.args["prompt"]);
        if (command === "/agent-models" || prompt === "/agent-models") {
          throw new Error("/agent-models must be executed directly by command-lead; task delegation is forbidden.");
        }
      }

      if (input.tool === "bounded_lite_route") {
        output.args = { ...output.args };
      }
    },
    "tool.execute.after"(_input, output) {
      output.output = output.output;
    },
  };
}

export default createBoundedLitePlugin;
