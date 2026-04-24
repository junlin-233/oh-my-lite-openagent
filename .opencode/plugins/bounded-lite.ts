import { MAX_CHILD_ORCHESTRATOR_DEPTH, type RoutingCategory } from "../lib/contracts.js";
import { BackgroundCoordinator } from "../lib/runtime/background.js";
import {
  type PluginHooks,
  type PluginInput,
} from "../lib/runtime/plugin-types.js";
import { resolveCategoryRoute } from "../lib/runtime/categories.js";
import { buildTaskDAG, type TaskDispatchConfig } from "../lib/runtime/plan-dag.js";
import { createRuntimeProfile } from "../lib/runtime/safety.js";
import {
  applyRoleModelConfig,
  formatAutoModelReport,
  formatModelConfigReport,
  listProviderModels,
  listProviderModelsFromResponse,
  mergeProviderModels,
  resolveAutoModels,
  summarizeRoleModels,
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
}

export function normalizePluginOptions(
  options: BoundedLitePluginOptions = {},
): Required<BoundedLitePluginOptions> {
  const mode = options.mode ?? "full";

  return {
    mode,
    enableHooks: options.enableHooks ?? true,
    enableBackground: options.enableBackground ?? mode === "full",
    enableBundledMcp: options.enableBundledMcp ?? false,
    maxChildDepth: options.maxChildDepth ?? MAX_CHILD_ORCHESTRATOR_DEPTH,
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

function defaultConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return path.resolve(process.env.OPENCODE_CONFIG_DIR);

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "opencode");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readOpenCodeConfig(): Promise<Record<string, unknown>> {
  const configPath = path.join(defaultConfigDir(), "opencode.json");
  const content = await readFile(configPath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

async function writeOpenCodeConfig(config: Record<string, unknown>): Promise<string> {
  const configPath = path.join(defaultConfigDir(), "opencode.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(`${configPath}.bak`, `${JSON.stringify(await readOpenCodeConfig(), null, 2)}\n`);
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
        description: `List, auto-configure, or update per-role OpenCode models for Oh My Lite OpenAgent.

Actions:
- list: Show current role model assignments and available provider models. Call with { "action": "list" }.
- auto: Automatically assign the best available model to each role based on role capability needs. Call with { "action": "auto" }.
- apply: Manually assign specific models to roles. Call with { "action": "apply", "assignments": { "role-name": "provider/model-id" } }.

Role capability summary:
- command-lead (orchestration): needs strongest reasoning
- plan-builder (planning): needs strong reasoning + structured output
- deep-plan-builder (advisory-planning): weaker OK, has mandatory plan review
- task-lead (execution): mid-tier models sufficient
- explore (fast-retrieval): fast, cheap models preferred
- librarian (fast-retrieval): fast, cheap models preferred
- plan-review (critical-review): needs strongest reasoning to catch errors
- result-review (critical-review): needs strongest reasoning to verify completeness

If no provider models are found, tell the user to configure providers and API keys in their OpenCode config first.`,
        async execute(args, context) {
          const action = typeof args["action"] === "string" ? args["action"] : "list";
          const config = await readOpenCodeConfig();
          const models = mergeProviderModels(
            await listRuntimeProviderModels(context),
            listProviderModels(config),
          );

          if (action === "list") {
            const roleLines = summarizeRoleModels(config).map((role) => {
              const source = role.inheritsGlobal ? "inherits global" : "configured";
              return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
            });

            const runtimeModels = await listRuntimeProviderModels(context);
            const configModels = listProviderModels(config);
            const debugLines = [
              `Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
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
                "1. Use action=apply to manually adjust models by name:",
                '   { "action": "apply", "assignments": { "command-lead": "anthropic/claude-opus-4-7" } }',
                "2. Or close this session and restart OpenCode, then try action=list again.",
              ].join("\n");
            }

            return formatModelConfigReport({
              roles: summarizeRoleModels(config),
              models,
            });
          }

if (action === "auto") {
            const autoResult = resolveAutoModels(models, config);

            if (models.length === 0 && autoResult.resolved.length === 0) {
              const roleLines = summarizeRoleModels(config).map((role) => {
                const source = role.inheritsGlobal ? "inherits global" : "configured";
                return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
              });

              const runtimeModels = await listRuntimeProviderModels(context);
              const configModels = listProviderModels(config);

              const helpLines = [
                "Oh My Lite OpenAgent auto model configuration",
                "",
                "No provider models found to auto-assign.",
                "",
                "Current role models:",
                ...roleLines,
                "",
                "Debug info:",
                `  Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
                `  Config-inferred models: ${configModels.length > 0 ? configModels.map((m) => m.id).join(", ") : "none"}`,
                "",
                "Your providers may be connected via /connect (stored in OpenCode credential",
                "store, not in opencode.json). If you already have models assigned to roles,",
                "you can use action=apply to adjust them:",
                '  { "action": "apply", "assignments": { "command-lead": "anthropic/claude-opus-4-7" } }',
                "",
                "If you want to add a provider configuration to opencode.json, the format is:",
                '  "provider": { "anthropic": { "apiKey": "sk-ant-...", "models": { "claude-opus-4-7": {} } } }',
              ];

              return helpLines.join("\n");
            }

            const assignments = autoResult.assignments;
            const result = applyRoleModelConfig(
              config,
              assignments,
              models.map((model) => model.id),
            );
            const configPath = await writeOpenCodeConfig(config);

            const reportLines = [
              formatAutoModelReport(autoResult),
              "",
              formatModelConfigReport({
                roles: summarizeRoleModels(config),
                models,
                changed: result.changed,
                skipped: result.skipped,
                warnings: result.warnings,
              }),
              "",
              `Updated ${configPath}. Restart OpenCode or start a new session if the active TUI keeps old model state.`,
            ];

            return reportLines.join("\n");
          }

          if (action === "apply") {
            const assignments = args["assignments"];

            if (typeof assignments !== "object" || assignments === null || Array.isArray(assignments)) {
              throw new Error(
                "bounded_lite_model_config apply requires assignments: { role: \"provider/model\" }.",
              );
            }

            const result = applyRoleModelConfig(
              config,
              assignments as Record<string, unknown>,
              models.map((model) => model.id),
            );
            const configPath = await writeOpenCodeConfig(config);

            return [
              formatModelConfigReport({
                roles: summarizeRoleModels(config),
                models,
                changed: result.changed,
                skipped: result.skipped,
                warnings: result.warnings,
              }),
              "",
              `Updated ${configPath}. Restart OpenCode or start a new session if the active TUI keeps old model state.`,
            ].join("\n");
          }

          throw new Error("bounded_lite_model_config action must be list, auto, or apply.");
        },
      },
    },
    "permission.ask"(input, output) {
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
