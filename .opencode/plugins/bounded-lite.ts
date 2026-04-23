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
  formatModelConfigReport,
  listProviderModels,
  listProviderModelsFromResponse,
  mergeProviderModels,
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
        description: "List or update per-role OpenCode models for Oh My Lite OpenAgent.",
        async execute(args, context) {
          const action = typeof args["action"] === "string" ? args["action"] : "list";
          const config = await readOpenCodeConfig();
          const models = mergeProviderModels(
            await listRuntimeProviderModels(context),
            listProviderModels(config),
          );

          if (action === "list") {
            return formatModelConfigReport({
              roles: summarizeRoleModels(config),
              models,
            });
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

          throw new Error("bounded_lite_model_config action must be list or apply.");
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
