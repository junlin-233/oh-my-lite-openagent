/**
 * Role model recommendations for Oh My Lite OpenAgent.
 *
 * Adapted from oh-my-openagent's model-requirements.ts for omo-lite's
 * eight-role architecture. Each role has a capability descriptor that
 * determines what kind of model it needs, and a priority-ordered list
 * of model recommendations.
 *
 * Role capability mapping (from omo roles):
 *   command-lead    ← sisyphus     : needs strongest reasoning (orchestration)
 *   plan-builder    ← prometheus   : needs strong reasoning + structured output (planning)
 *   deep-plan-builder ← metis     : detailed plans for lower-strength executors, with mandatory review (advisory-planning)
 *   task-lead       ← sisyphus-junior : mid-tier execution (execution)
 *   explore         ← explore      : fast, cheap (fast-retrieval)
 *   librarian       ← librarian    : fast, cheap (fast-retrieval)
 *   plan-review     ← momus        : needs very strong reasoning to catch errors (critical-review)
 *   result-review   ← momus        : needs very strong reasoning to catch errors (critical-review)
 */

import type { RoleName } from "../contracts.js";
import { ROLE_CONTRACTS } from "../contracts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Provider model info (mirrored from model-config.ts to avoid circular imports).
 * Represents a model available from a specific provider.
 */
export interface ProviderModel {
  provider: string;
  model: string;
  id: string;
  name?: string;
  apiModelId?: string;
  source?: "opencode-subscription" | "api-provider" | "gateway" | "unknown";
  family?: "gpt" | "claude" | "gemini" | "kimi" | "minimax" | "glm" | "codex" | "other";
  origin?: "opencode-json-provider" | "runtime-provider-list" | "models-dev-fallback" | "configured-model" | "credential-provider-fallback";
  reasoning?: boolean;
  variants?: string[];
}

export type RoleCapability =
  | "orchestration"
  | "planning"
  | "advisory-planning"
  | "execution"
  | "fast-retrieval"
  | "critical-review";

export interface ModelRecommendation {
  /**
   * Pattern to match against provider/model IDs.
   * Uses case-insensitive substring matching.
   * E.g. "claude-opus" matches "anthropic/claude-opus-4-7"
   */
  pattern: string;
  /** Human-readable reason this model is recommended for this role */
  reason: string;
}

export interface RoleModelProfile {
  role: RoleName;
  capability: RoleCapability;
  /** Human-readable description of the role's model needs */
  description: string;
  /** Priority-ordered model recommendations. First match wins. */
  recommendations: ModelRecommendation[];
}

export interface AutoModelResult {
  assignments: Record<string, string>;
  /** Roles that got a recommended model assigned */
  resolved: Array<{
    role: RoleName;
    model: string;
    matchedPattern: string;
  }>;
  /** Roles that had no matching model in the available set */
  unresolved: Array<{
    role: RoleName;
    capability: RoleCapability;
  }>;
}

// ---------------------------------------------------------------------------
// Capability descriptions (used by the auto command to explain choices)
// ---------------------------------------------------------------------------

export const ROLE_CAPABILITY_DESCRIPTIONS: Readonly<Record<RoleCapability, string>> = {
  orchestration:
    "Needs the strongest reasoning model available. This role orchestrates all work, routes tasks, and makes critical decisions.",
  planning:
    "Needs strong reasoning and structured output. This role generates executable plans with dependencies and acceptance criteria.",
  "advisory-planning":
    "Produces detailed plans suitable for lower-strength executors. Mandatory plan review compensates for the higher handoff risk.",
  execution:
    "Can use mid-tier models. This role executes bounded tasks with clear scope and deliverables.",
  "fast-retrieval":
    "Should use fast, cheap models. This role does read-only exploration or external research where latency matters more than deep reasoning.",
  "critical-review":
    "Needs very strong reasoning to catch subtle errors and gaps. This role reviews plans and results, and must be thorough and skeptical.",
};

// ---------------------------------------------------------------------------
// Role model profiles
// ---------------------------------------------------------------------------

export const ROLE_MODEL_PROFILES: readonly RoleModelProfile[] = [
  {
    role: "command-lead",
    capability: "orchestration",
    description: "Main orchestrator — needs the strongest reasoning model to route, delegate, and verify.",
    recommendations: [
      // Tier 1: strongest reasoning — Claude Opus
      { pattern: "claude-opus", reason: "Best orchestration model with strong multi-step reasoning" },
      // Tier 2: very strong reasoning — GPT-5.4
      { pattern: "gpt-5.4", reason: "Strong reasoning and tool use" },
      // Tier 3: strong reasoning — Gemini Pro
      { pattern: "gemini-2.5-pro", reason: "Good reasoning with long context" },
      { pattern: "gemini-3.1-pro", reason: "Good reasoning with long context" },
      // Tier 4: solid mid-high reasoning
      { pattern: "claude-sonnet", reason: "Strong reasoning, slightly below Opus" },
      { pattern: "kimi-k2", reason: "Good coding capability" },
      { pattern: "gpt-4o", reason: "Capable general-purpose model" },
      // Tier 5: mid-tier fallback
      { pattern: "glm-5", reason: "Capable Chinese-developed model" },
      { pattern: "minimax-m2", reason: "Decent mid-tier fallback" },
      // Tier 6: free / low-cost final fallback
      { pattern: "big-pickle", reason: "Free opencode/ fallback — lowest tier but always available" },
      { pattern: "gpt-5-nano", reason: "Ultra-low-cost fallback" },
    ],
  },
  {
    role: "plan-builder",
    capability: "planning",
    description: "Visible planner — needs strong reasoning to generate structured, executable plans.",
    recommendations: [
      { pattern: "claude-opus", reason: "Best at structured planning with clear dependencies" },
      { pattern: "gpt-5.4", reason: "Strong structured output and reasoning" },
      { pattern: "gemini-2.5-pro", reason: "Good at structured generation" },
      { pattern: "gemini-3.1-pro", reason: "Good at structured generation" },
      { pattern: "claude-sonnet", reason: "Capable planning with good follow-through" },
      { pattern: "kimi-k2", reason: "Good structured output" },
      { pattern: "gpt-4o", reason: "Capable planning model" },
      { pattern: "glm-5", reason: "Reasonable planning capability" },
      { pattern: "minimax-m2", reason: "Basic planning fallback" },
      { pattern: "big-pickle", reason: "Free fallback" },
    ],
  },
  {
    role: "deep-plan-builder",
    capability: "advisory-planning",
    description: "Deep planner — produces detailed plans suitable for lower-strength executors.",
    recommendations: [
      // This role produces detailed plans that lower-strength executors can follow.
      { pattern: "claude-sonnet", reason: "Strong planning with good context handling" },
      { pattern: "kimi-k2", reason: "Good reasoning for planning tasks" },
      { pattern: "gemini-3-flash", reason: "Fast and capable for advisory planning" },
      { pattern: "gpt-5.4", reason: "Strong reasoning if available" },
      { pattern: "claude-opus", reason: "Excellent if available" },
      { pattern: "gpt-4o", reason: "Capable alternative" },
      { pattern: "gpt-5.3-codex", reason: "Reasonable coding-focused alternative" },
      { pattern: "glm-5", reason: "Reasonable Chinese-developed alternative" },
      { pattern: "minimax-m2", reason: "Budget fallback with mandatory review" },
      { pattern: "big-pickle", reason: "Free fallback with mandatory review" },
    ],
  },
  {
    role: "task-lead",
    capability: "execution",
    description: "Bounded task executor — mid-tier models sufficient for clear-scope implementation.",
    recommendations: [
      { pattern: "claude-sonnet", reason: "Strong execution with good context handling" },
      { pattern: "kimi-k2", reason: "Good coding capability for implementation" },
      { pattern: "gpt-5.4", reason: "Strong code generation" },
      { pattern: "gemini-2.5-pro", reason: "Good implementation capability" },
      { pattern: "gemini-3.1-pro", reason: "Good implementation capability" },
      { pattern: "gpt-4o", reason: "Capable implementation model" },
      { pattern: "gpt-5.3-codex", reason: "Coding-focused implementation model" },
      { pattern: "minimax-m2", reason: "Decent mid-tier execution" },
      { pattern: "gpt-5-nano", reason: "Budget execution fallback" },
      { pattern: "big-pickle", reason: "Free execution fallback" },
    ],
  },
  {
    role: "explore",
    capability: "fast-retrieval",
    description: "Read-only code exploration — fast, cheap models preferred for low-latency lookups.",
    recommendations: [
      { pattern: "gpt-5.4-mini", reason: "Fast and cheap for exploration" },
      { pattern: "claude-haiku", reason: "Very fast with good accuracy" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed retrieval" },
      { pattern: "minimax-m2", reason: "Fast retrieval" },
      { pattern: "gemini-2.0-flash", reason: "Fast exploration" },
      { pattern: "gemini-3-flash", reason: "Fast exploration" },
      { pattern: "gpt-5-nano", reason: "Budget-fast exploration" },
      { pattern: "big-pickle", reason: "Free fallback for exploration" },
    ],
  },
  {
    role: "librarian",
    capability: "fast-retrieval",
    description: "External research — fast, cheap models preferred for documentation lookups.",
    recommendations: [
      { pattern: "gpt-5.4-mini", reason: "Fast and cheap for research" },
      { pattern: "claude-haiku", reason: "Fast with good accuracy for docs" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed research" },
      { pattern: "minimax-m2", reason: "Fast research" },
      { pattern: "gemini-2.0-flash", reason: "Fast documentation lookup" },
      { pattern: "gemini-3-flash", reason: "Fast documentation lookup" },
      { pattern: "gpt-5-nano", reason: "Budget-fast research" },
      { pattern: "big-pickle", reason: "Free fallback for research" },
    ],
  },
  {
    role: "plan-review",
    capability: "critical-review",
    description: "Plan review — needs the strongest reasoning to catch subtle errors and gaps in plans.",
    recommendations: [
      { pattern: "gpt-5.4", reason: "Strongest reasoning for catching plan errors" },
      { pattern: "claude-opus", reason: "Excellent at critical analysis" },
      { pattern: "gemini-2.5-pro", reason: "Good at structured evaluation" },
      { pattern: "gemini-3.1-pro", reason: "Good at structured evaluation" },
      { pattern: "claude-sonnet", reason: "Good evaluation capability" },
      { pattern: "gpt-4o", reason: "Decent review capability" },
      { pattern: "glm-5", reason: "Reasonable review capability" },
      { pattern: "minimax-m2", reason: "Basic review fallback" },
      { pattern: "big-pickle", reason: "Free fallback for review" },
    ],
  },
  {
    role: "result-review",
    capability: "critical-review",
    description: "Result review — needs the strongest reasoning to verify execution completeness and quality.",
    recommendations: [
      { pattern: "gpt-5.4", reason: "Strongest reasoning for result verification" },
      { pattern: "claude-opus", reason: "Excellent at detecting missing or incorrect results" },
      { pattern: "gemini-2.5-pro", reason: "Good at comprehensive evaluation" },
      { pattern: "gemini-3.1-pro", reason: "Good at comprehensive evaluation" },
      { pattern: "claude-sonnet", reason: "Good verification capability" },
      { pattern: "gpt-4o", reason: "Decent result verification" },
      { pattern: "glm-5", reason: "Reasonable verification" },
      { pattern: "minimax-m2", reason: "Basic verification fallback" },
      { pattern: "big-pickle", reason: "Free fallback for verification" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Auto-resolution engine
// ---------------------------------------------------------------------------

/**
 * Check whether a model ID matches a recommendation pattern.
 * Uses case-insensitive substring matching against the full `provider/model` ID.
 */
function matchesPattern(modelId: string, pattern: string): boolean {
  return modelId.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Resolve the best available model for each role based on the
 * priority-ordered recommendation profiles.
 *
 * @param availableModels - Models available from the user's provider configuration
 * @param currentConfig - Current opencode.json config (used to preserve existing assignments)
 * @returns AutoModelResult with assignments, resolved details, and unresolved roles
 */
export function resolveAutoModels(
  availableModels: readonly ProviderModel[],
  currentConfig?: Record<string, unknown>,
): AutoModelResult {
  const assignments: Record<string, string> = {};
  const resolved: AutoModelResult["resolved"] = [];
  const unresolved: AutoModelResult["unresolved"] = [];

  const modelIds = availableModels.map((model) => model.id);

  // Preserve existing model assignments from current config
  const agents = currentConfig?.agent;
  const existingAssignments: Record<string, string> = {};
  if (agents && typeof agents === "object" && agents !== null && !Array.isArray(agents)) {
    for (const [role, agentValue] of Object.entries(agents as Record<string, unknown>)) {
      if (typeof agentValue === "object" && agentValue !== null && !Array.isArray(agentValue)) {
        const agent = agentValue as Record<string, unknown>;
        if (typeof agent.model === "string") {
          existingAssignments[role] = agent.model;
        }
      }
    }
  }

  for (const profile of ROLE_MODEL_PROFILES) {
    let bestModel: string | undefined;
    let matchedPattern: string | undefined;

    // Try each recommendation in priority order
    for (const recommendation of profile.recommendations) {
      const matchedModelId = modelIds.find((id) => matchesPattern(id, recommendation.pattern));
      if (matchedModelId) {
        bestModel = matchedModelId;
        matchedPattern = recommendation.pattern;
        break;
      }
    }

    if (bestModel && matchedPattern) {
      assignments[profile.role] = bestModel;
      resolved.push({
        role: profile.role,
        model: bestModel,
        matchedPattern,
      });
    } else {
      unresolved.push({
        role: profile.role,
        capability: profile.capability,
      });
    }
  }

  return { assignments, resolved, unresolved };
}

/**
 * Format the auto-resolution result as a human-readable report.
 */
export function formatAutoModelReport(result: AutoModelResult): string {
  const lines: string[] = [
    "Oh My Lite OpenAgent auto model configuration",
    "",
    "Role recommendations (based on omo role-model research):",
  ];

  for (const profile of ROLE_MODEL_PROFILES) {
    const capabilityDesc = ROLE_CAPABILITY_DESCRIPTIONS[profile.capability];
    lines.push(`\n  ${profile.role} (${profile.capability}):`);
    lines.push(`    ${capabilityDesc}`);
  }

  lines.push("", "Resolved assignments:");

  if (result.resolved.length > 0) {
    for (const item of result.resolved) {
      const profile = ROLE_MODEL_PROFILES.find((p) => p.role === item.role);
      const reason = profile?.recommendations.find(
        (r) => r.pattern === item.matchedPattern,
      )?.reason ?? "Best available match";
      lines.push(`  ✓ ${item.role}: ${item.model} (${reason})`);
    }
  } else {
    lines.push("  <none resolved>");
  }

  if (result.unresolved.length > 0) {
    lines.push("", "Unresolved roles (no matching model found):");
    for (const item of result.unresolved) {
      const capabilityDesc = ROLE_CAPABILITY_DESCRIPTIONS[item.capability];
      lines.push(`  ✗ ${item.role}: needs ${item.capability} — ${capabilityDesc}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get all unique model patterns across all roles.
 * Useful for the install script to list what model types are relevant.
 */
export function getAllRecommendedPatterns(): string[] {
  const patterns = new Set<string>();
  for (const profile of ROLE_MODEL_PROFILES) {
    for (const recommendation of profile.recommendations) {
      patterns.add(recommendation.pattern);
    }
  }
  return [...patterns].sort();
}

/**
 * Validate that all configurable role names have a model profile.
 */
export function validateProfileCoverage(): Array<{ role: RoleName; hasProfile: boolean }> {
  return ROLE_CONTRACTS.map((contract) => ({
    role: contract.name,
    hasProfile: ROLE_MODEL_PROFILES.some((profile) => profile.role === contract.name),
  }));
}
