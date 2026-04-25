import { MAX_CHILD_ORCHESTRATOR_DEPTH, type RoutingCategory } from "../lib/contracts.js";
import { BackgroundCoordinator } from "../lib/runtime/background.js";
import {
  type PluginHooks,
  type PluginInput,
} from "../lib/runtime/plugin-types.js";
import { resolveCategoryRoute } from "../lib/runtime/categories.js";
import { buildTaskDAG, type TaskDispatchConfig } from "../lib/runtime/plan-dag.js";
import { validatePlanReadiness } from "../lib/runtime/plan-readiness.js";
import { writePlanArtifact } from "../lib/runtime/plan-artifact.js";
import { createRuntimeProfile } from "../lib/runtime/safety.js";
import {
  applyRoleModelConfig,
  applyTaskLeadProfileModelConfig,
  formatAutoModelReport,
  formatModelImportReport,
  formatModelConfigReport,
  formatTaskLeadProfileModelReport,
  importModelPool,
  inferModelPoolPolicy,
  listKnownModelsForCredentialProviders,
  listProviderModels,
  listProviderModelsFromResponse,
  mergeProviderModels,
  type ModelFamily,
  type ModelPoolPolicy,
  type ModelProviderSource,
  resolveAutoModels,
  resolveAutoTaskLeadProfileModels,
  summarizeRoleModels,
  summarizeTaskLeadProfileModels,
} from "../lib/runtime/model-config.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface BoundedLitePluginOptions {
  mode?: "full" | "degraded";
  enableHooks?: boolean;
  enableBackground?: boolean;
  enableBundledMcp?: boolean;
  maxChildDepth?: number;
  configDir?: string;
}

export interface NormalizedBoundedLitePluginOptions {
  mode: "full" | "degraded";
  enableHooks: boolean;
  enableBackground: boolean;
  enableBundledMcp: boolean;
  maxChildDepth: number;
  configDir?: string;
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

async function readOpenCodeConfig(configDir?: string): Promise<Record<string, unknown>> {
  const configPath = path.join(defaultConfigDir(configDir), "opencode.json");
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
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
  const configPath = path.join(defaultConfigDir(configDir), "opencode.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(`${configPath}.bak`, `${JSON.stringify(await readOpenCodeConfig(configDir), null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
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

function readModelPoolPolicy(args: Record<string, unknown>): ModelPoolPolicy {
  const policy = isRecord(args["policy"]) ? args["policy"] : {};
  const sourceValue = typeof policy["source"] === "string"
    ? policy["source"]
    : typeof args["source"] === "string"
      ? args["source"]
      : undefined;
  const source = isModelSourceFilter(sourceValue) ? sourceValue : undefined;
  const providerPreference = readStringArray(policy["providerPreference"] ?? args["providerPreference"]);
  const familyPreference = readFamilyArray(policy["familyPreference"] ?? args["familyPreference"]);
  const allowCodexBackend = typeof policy["allowCodexBackend"] === "boolean"
    ? policy["allowCodexBackend"]
    : typeof args["allowCodexBackend"] === "boolean"
      ? args["allowCodexBackend"]
      : undefined;

  return {
    ...(source ? { source } : {}),
    ...(providerPreference.length > 0 ? { providerPreference } : {}),
    ...(familyPreference.length > 0 ? { familyPreference } : {}),
    ...(typeof allowCodexBackend === "boolean" ? { allowCodexBackend } : {}),
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function readFamilyArray(value: unknown): ModelFamily[] {
  const valid = new Set<ModelFamily>(["gpt", "claude", "gemini", "kimi", "minimax", "glm", "codex", "other"]);
  return readStringArray(value).filter((item): item is ModelFamily => valid.has(item as ModelFamily));
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
        execute(args) {
          const category = args["category"];

          if (!isRoutingCategory(category)) {
            throw new Error("Route tool requires a valid bounded routing category.");
          }

          return resolveCategoryRoute(category);
        },
      },
      bounded_lite_plan_dag: {
        description: "Validate a required plan.subtasks payload and return bounded DAG waves plus dispatch profiles.",
        execute(args) {
          const payload = args["payload"];
          const dispatch = isRecord(args["dispatch"]) ? args["dispatch"] : {};

          return buildTaskDAG(payload, dispatch as Partial<TaskDispatchConfig>);
        },
      },
      bounded_lite_plan_readiness: {
        description: "Validate a Plan Builder artifact against readiness gates before Command Lead dispatches execution.",
        execute(args) {
          const payload = args["payload"];
          const dispatch = isRecord(args["dispatch"]) ? args["dispatch"] : {};

          return validatePlanReadiness(payload, dispatch as Partial<TaskDispatchConfig>);
        },
      },
      bounded_lite_plan_artifact: {
        description: "Persist a Command Lead-approved plan artifact under .liteagent/plans and append .liteagent/plan-index.jsonl.",
        async execute(args, context) {
          const action = readString(args["action"]) ?? "write";
          if (action !== "write") {
            throw new Error("bounded_lite_plan_artifact action must be write.");
          }

          const title = readString(args["title"]);
          const markdown = readString(args["markdown"]) ?? readString(args["content"]);
          if (!title || !markdown) {
            throw new Error("bounded_lite_plan_artifact write requires title and markdown.");
          }

          const planId = readString(args["planId"]) ?? readString(args["plan_id"]);
          const maturityLevel = readString(args["maturityLevel"]) ?? readString(args["maturity_level"]);
          const generatedBy = readString(args["generatedBy"]) ?? readString(args["generated_by"]);
          const requestedPath = readString(args["path"]) ?? readString(args["recommended_plan_path"]);
          const result = await writePlanArtifact({
            projectRoot: resolveProjectRoot(context),
            title,
            markdown,
            artifactKind: args["artifactKind"] === "detailed-plan" ? "detailed-plan" : "plan-skeleton",
            status: args["status"] === "reviewed" || args["status"] === "blocked" ? args["status"] : "draft",
            overwrite: args["overwrite"] === true,
            ...(planId ? { planId } : {}),
            ...(maturityLevel ? { maturityLevel } : {}),
            ...(generatedBy ? { generatedBy } : {}),
            ...(requestedPath ? { requestedPath } : {}),
          });

          return [
            "Oh My Lite OpenAgent plan artifact persisted",
            "",
            `Plan ID: ${result.planId}`,
            `Path: ${result.relativePath}`,
            `Index: .liteagent/plan-index.jsonl`,
            `Bytes: ${result.bytes}`,
            `Overwritten: ${result.overwritten ? "yes" : "no"}`,
          ].join("\n");
        },
      },
      bounded_lite_background: {
        description: "List currently tracked background tasks from the bounded coordinator.",
        execute() {
          return background.list();
        },
      },
      bounded_lite_runtime_profile: {
        description: "Report the current runtime profile without creating a second control plane.",
        execute() {
          return runtimeProfile;
        },
      },
      bounded_lite_model_config: {
        description: `Import, list, recommend, or update per-role and Task Lead profile OpenCode models for Oh My Lite OpenAgent.

Actions:
	- import: Import all available OpenCode model providers by default. Call with { "action": "import" }.
- list: Show current role model assignments and available provider models. Call with { "action": "list" }.
- auto: Recommend role and Task Lead profile model assignments from the imported model pool based on capability needs. This does not write config. Call with { "action": "auto" }.
- apply: Manually assign specific models to roles or profiles. Call with { "action": "apply", "assignments": { "role-name": "provider/model-id" }, "taskLeadProfileAssignments": { "code": "provider/model-id" } }.

Policy:
	- source and providerPreference are optional narrowing filters; by default the imported pool includes every discovered provider.
- allowCodexBackend defaults to false.
- familyPreference can limit the imported pool, for example { "familyPreference": ["gpt"] } for GPT-family subscription models.

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
- After action=auto, ask the user whether they want to modify the recommendations before calling action=apply.

If no provider models are found, tell the user to configure or connect OpenCode providers first.`,
        async execute(args, context) {
          const action = typeof args["action"] === "string" ? args["action"] : "list";
          const config = await readOpenCodeConfig(options.configDir);
          const credentialModels = listKnownModelsForCredentialProviders(
            await readOpenCodeAuthProviderIds(),
          );
          const models = mergeProviderModels(
            mergeProviderModels(await listRuntimeProviderModels(context), credentialModels),
            listProviderModels(config),
          );
          const inferredPolicy = inferModelPoolPolicy(config, readModelPoolPolicy(args));
          const poolPolicy = inferredPolicy.policy;
          const importedPool = importModelPool(models, poolPolicy);

          if (action === "import") {
            return [
              inferredPolicy.reason,
              "",
              formatModelImportReport({
                models: importedPool,
                policy: poolPolicy,
              }),
            ].join("\n");
          }

          if (action === "list") {
            const roleLines = summarizeRoleModels(config).map((role) => {
              const source = role.inheritsGlobal ? "inherits global" : "configured";
              return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
            });

	            const runtimeModels = await listRuntimeProviderModels(context);
	            const configModels = listProviderModels(config);
	            const credentialModels = listKnownModelsForCredentialProviders(
	              await readOpenCodeAuthProviderIds(),
	            );
	            const debugLines = [
	              `Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
	              `Credential fallback models: ${credentialModels.length > 0 ? credentialModels.map((m) => m.id).join(", ") : "none"}`,
	              `Config-inferred models: ${configModels.length > 0 ? configModels.map((m) => m.id).join(", ") : "none"}`,
	            ];

            if (models.length === 0) {
              return [
                "Oh My Lite OpenAgent role model configuration",
                "",
                "Current role models:",
                ...roleLines,
                "",
                "Available provider models:",
                "- <none found>",
                "",
                "Debug info:",
                ...debugLines,
                "",
                "No provider models were detected from either runtime or config.",
                "This usually means your OpenCode provider configuration is stored",
                "in the internal credential store (via /connect) rather than in",
                "opencode.json's \"provider\" key.",
                "",
                "Since you already have models assigned to roles above, you can:",
                "1. Use action=import to inspect the eligible inferred model pool.",
                "2. Use action=apply only with model IDs returned by action=import.",
                '   { "action": "apply", "assignments": { "command-lead": "provider/model" } }',
              ].join("\n");
            }

            return formatModelConfigReport({
              roles: summarizeRoleModels(config),
              taskLeadProfiles: summarizeTaskLeadProfileModels(config),
              models,
            });
          }

          if (action === "auto") {
            const autoResult = resolveAutoModels(importedPool, config);
            const profileAutoResult = resolveAutoTaskLeadProfileModels(importedPool);

            if (importedPool.length === 0 && autoResult.resolved.length === 0 && profileAutoResult.resolved.length === 0) {
              const roleLines = summarizeRoleModels(config).map((role) => {
                const source = role.inheritsGlobal ? "inherits global" : "configured";
                return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
              });

	              const runtimeModels = await listRuntimeProviderModels(context);
	              const configModels = listProviderModels(config);
	              const credentialModels = listKnownModelsForCredentialProviders(
	                await readOpenCodeAuthProviderIds(),
	              );
	
	              const helpLines = [
                "Oh My Lite OpenAgent auto model configuration",
                "",
                "No imported models found to recommend.",
                "",
                inferredPolicy.reason,
                "",
                formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                "",
                "Current role models:",
                ...roleLines,
                "",
	                "Debug info:",
	                `  Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
	                `  Credential fallback models: ${credentialModels.length > 0 ? credentialModels.map((m) => m.id).join(", ") : "none"}`,
	                `  Config-inferred models: ${configModels.length > 0 ? configModels.map((m) => m.id).join(", ") : "none"}`,
                "",
                "Use action=import first to inspect the available pool.",
                "The default pool includes every discovered provider unless policy overrides are provided.",
              ];

              return helpLines.join("\n");
            }

            const assignments = autoResult.assignments;
            const taskLeadProfileAssignments = profileAutoResult.assignments;
            const reportLines = [
              inferredPolicy.reason,
              "",
              formatAutoModelReport(autoResult),
              "",
              formatTaskLeadProfileModelReport(profileAutoResult),
              "",
              formatModelConfigReport({
                roles: summarizeRoleModels(config),
                taskLeadProfiles: summarizeTaskLeadProfileModels(config),
                models: importedPool,
              }),
              "",
              "Recommended assignments JSON:",
              JSON.stringify(assignments, null, 2),
              "",
              "Recommended Task Lead profile assignments JSON:",
              JSON.stringify(taskLeadProfileAssignments, null, 2),
              "",
              "Preview only. Ask the user whether they want to modify these assignments, then call action=apply to write them.",
            ];

            return reportLines.join("\n");
          }

          if (action === "apply") {
            const assignments = args["assignments"];
            const taskLeadProfileAssignments = args["taskLeadProfileAssignments"] ?? args["profileAssignments"];

            const hasRoleAssignments = typeof assignments === "object" && assignments !== null && !Array.isArray(assignments);
            const hasProfileAssignments = typeof taskLeadProfileAssignments === "object" &&
              taskLeadProfileAssignments !== null &&
              !Array.isArray(taskLeadProfileAssignments);

            if (!hasRoleAssignments && !hasProfileAssignments) {
              throw new Error(
                "bounded_lite_model_config apply requires assignments or taskLeadProfileAssignments with provider/model values.",
              );
            }

            const result = hasRoleAssignments ? applyRoleModelConfig(
              config,
              assignments as Record<string, unknown>,
              importedPool.map((model) => model.id),
              {
                allowUnavailableModels: args["allowUnavailableModels"] === true,
              },
            ) : { changed: [], skipped: [], warnings: [] };
            const profileResult = hasProfileAssignments ? applyTaskLeadProfileModelConfig(
              config,
              taskLeadProfileAssignments as Record<string, unknown>,
              importedPool.map((model) => model.id),
              {
                allowUnavailableModels: args["allowUnavailableModels"] === true,
              },
            ) : { changed: [], skipped: [], warnings: [] };
            const configPath = await writeOpenCodeConfig(config, options.configDir);

            return [
              formatModelConfigReport({
                roles: summarizeRoleModels(config),
                taskLeadProfiles: summarizeTaskLeadProfileModels(config),
                models: importedPool,
                changed: result.changed,
                skipped: result.skipped,
                warnings: result.warnings,
                profileChanged: profileResult.changed,
                profileSkipped: profileResult.skipped,
                profileWarnings: profileResult.warnings,
              }),
              "",
              `Updated ${configPath}. Restart OpenCode or start a new session if the active TUI keeps old model state.`,
            ].join("\n");
          }

          throw new Error("bounded_lite_model_config action must be import, list, auto, or apply.");
        },
      },
    },
    "permission.ask"(input, output) {
      if (input.tool === "bounded_lite_model_config" || input.tool === "bounded_lite_plan_artifact") {
        output.status = "ask";
        return;
      }

      if (input.tool.startsWith("bounded_lite_")) {
        output.status = "allow";
      }
    },
    "tool.execute.before"(input, output) {
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
