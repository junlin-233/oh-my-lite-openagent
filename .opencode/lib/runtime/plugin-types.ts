import type { RoutingCategory } from "../contracts.js";

export interface PluginInput {
  directory: string;
  worktree?: string;
  project?: {
    root: string;
  };
  client?: unknown;
  serverUrl?: URL;
  $?: unknown;
}

export type PermissionStatus = "allow" | "ask" | "deny";

export interface PermissionRequest {
  tool: string;
  action: string;
}

export interface ToolExecutionBefore {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionAfter {
  tool: string;
  output: unknown;
}

export interface ToolDefinition {
  description: string;
  execute: (args: Record<string, unknown>, context: PluginInput) => Promise<unknown> | unknown;
}

export interface PluginHooks {
  config?: (input: unknown) => Promise<void> | void;
  event?: (input: { event: { name: string; payload?: unknown } }) => Promise<void> | void;
  tool?: Record<string, ToolDefinition>;
  "permission.ask"?: (
    input: PermissionRequest,
    output: { status: PermissionStatus },
  ) => Promise<void> | void;
  "tool.execute.before"?: (
    input: ToolExecutionBefore,
    output: { args: Record<string, unknown> },
  ) => Promise<void> | void;
  "tool.execute.after"?: (
    input: ToolExecutionAfter,
    output: { output: unknown },
  ) => Promise<void> | void;
}

export interface RouteToolArgs {
  category: RoutingCategory;
}

export type PluginFactory = (
  input: PluginInput,
  options?: Record<string, unknown>,
) => Promise<PluginHooks> | PluginHooks;
