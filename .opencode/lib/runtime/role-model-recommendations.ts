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
  connected?: boolean;
  priorityScore?: number;
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
    source?: ProviderModel["origin"];
    connected?: boolean;
    priorityScore?: number;
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
      { pattern: "gpt-5.4", reason: "Preferred orchestration model with strong tool use and routing stability" },
      { pattern: "gpt-5.5", reason: "Stronger GPT-family orchestration fallback when available" },
      { pattern: "claude-opus-4-7", reason: "Very strong orchestration fallback with deep reasoning" },
      { pattern: "claude-opus-4-6", reason: "Very strong orchestration fallback with deep reasoning" },
      { pattern: "kimi-k2.6", reason: "Strong OpenCode Go orchestration option" },
      { pattern: "deepseek-v4-pro", reason: "Strong OpenCode Go reasoning and coding fallback" },
      { pattern: "qwen3.6-plus", reason: "Solid OpenCode Go orchestration fallback" },
      { pattern: "glm-5.1", reason: "Capable OpenCode Go general fallback" },
      { pattern: "minimax-m2.7", reason: "Usable OpenCode Go fallback when stronger models are unavailable" },
      { pattern: "big-pickle", reason: "Free opencode/ fallback — lowest tier but always available" },
      { pattern: "gpt-5.4-nano", reason: "Ultra-low-cost final fallback" },
    ],
  },
  {
    role: "plan-builder",
    capability: "planning",
    description: "Visible planner — needs strong reasoning to generate structured, executable plans.",
    recommendations: [
      { pattern: "claude-opus-4-7", reason: "Best at structured planning with clear dependencies" },
      { pattern: "gpt-5.4", reason: "Strong structured output and reasoning" },
      { pattern: "deepseek-v4-pro", reason: "Strong planning and code-aware fallback" },
      { pattern: "claude-sonnet-4-6", reason: "Capable planning with good follow-through" },
      { pattern: "kimi-k2.6", reason: "Good OpenCode Go planning option" },
      { pattern: "qwen3.6-plus", reason: "Solid OpenCode Go structured-output fallback" },
      { pattern: "glm-5.1", reason: "Reasonable OpenCode Go planning fallback" },
      { pattern: "gemini-3.1-pro", reason: "Usable planning fallback where Gemini is available" },
      { pattern: "minimax-m2.7", reason: "Basic OpenCode Go planning fallback" },
      { pattern: "big-pickle", reason: "Free fallback" },
    ],
  },
  {
    role: "deep-plan-builder",
    capability: "advisory-planning",
    description: "Deep planner — produces detailed plans suitable for lower-strength executors.",
    recommendations: [
      { pattern: "claude-opus-4-7", reason: "Best deep planning model for detailed executable handoffs" },
      { pattern: "gpt-5.4", reason: "Strong reasoning and structure for deep planning" },
      { pattern: "deepseek-v4-pro", reason: "Strong OpenCode Go deep-planning fallback" },
      { pattern: "claude-sonnet-4-6", reason: "Good detailed-planning fallback" },
      { pattern: "kimi-k2.6", reason: "Good OpenCode Go planning fallback" },
      { pattern: "qwen3.6-plus", reason: "Solid OpenCode Go long-form planning fallback" },
      { pattern: "glm-5.1", reason: "Usable OpenCode Go structured fallback" },
      { pattern: "minimax-m2.7", reason: "Budget OpenCode Go fallback with mandatory review" },
      { pattern: "big-pickle", reason: "Free fallback with mandatory review" },
    ],
  },
  {
    role: "task-lead",
    capability: "execution",
    description: "Bounded task executor — mid-tier models sufficient for clear-scope implementation.",
    recommendations: [
      { pattern: "claude-sonnet-4-6", reason: "Strong execution with good context handling" },
      { pattern: "gpt-5.4", reason: "Preferred GPT-family implementation model" },
      { pattern: "kimi-k2.6", reason: "Strong OpenCode Go coding execution option" },
      { pattern: "kimi-k2.5", reason: "Strong OpenCode Go coding fallback" },
      { pattern: "deepseek-v4-pro", reason: "Strong OpenCode Go code generation fallback" },
      { pattern: "gpt-5.3-codex", reason: "Coding-focused implementation model" },
      { pattern: "qwen3.6-plus", reason: "Solid OpenCode Go execution fallback" },
      { pattern: "minimax-m2.7", reason: "Decent OpenCode Go mid-tier execution fallback" },
      { pattern: "minimax-m2.5", reason: "Budget OpenCode Go execution fallback" },
      { pattern: "gpt-5.4-nano", reason: "Budget execution fallback" },
      { pattern: "big-pickle", reason: "Free execution fallback" },
    ],
  },
  {
    role: "explore",
    capability: "fast-retrieval",
    description: "Read-only code exploration — fast, cheap models preferred for low-latency lookups.",
    recommendations: [
      { pattern: "gpt-5.4-mini", reason: "Fast and cheap for exploration" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed retrieval" },
      { pattern: "minimax-m2.7", reason: "Fast OpenCode Go retrieval fallback" },
      { pattern: "claude-haiku-4-5", reason: "Very fast with good accuracy" },
      { pattern: "deepseek-v4-flash", reason: "Fast OpenCode Go exploration fallback" },
      { pattern: "qwen3.5-plus", reason: "Fast OpenCode Go retrieval fallback" },
      { pattern: "gpt-5.4-nano", reason: "Budget-fast exploration" },
      { pattern: "big-pickle", reason: "Free fallback for exploration" },
    ],
  },
  {
    role: "librarian",
    capability: "fast-retrieval",
    description: "External research — fast, cheap models preferred for documentation lookups.",
    recommendations: [
      { pattern: "gpt-5.4-mini", reason: "Fast and cheap for research" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed research" },
      { pattern: "minimax-m2.7", reason: "Fast OpenCode Go research fallback" },
      { pattern: "claude-haiku-4-5", reason: "Fast with good accuracy for docs" },
      { pattern: "deepseek-v4-flash", reason: "Fast OpenCode Go documentation fallback" },
      { pattern: "qwen3.5-plus", reason: "Fast OpenCode Go documentation lookup fallback" },
      { pattern: "gpt-5.4-nano", reason: "Budget-fast research" },
      { pattern: "big-pickle", reason: "Free fallback for research" },
    ],
  },
  {
    role: "plan-review",
    capability: "critical-review",
    description: "Plan review — needs the strongest reasoning to catch subtle errors and gaps in plans.",
    recommendations: [
      { pattern: "gpt-5.4", reason: "Strongest reasoning for catching plan errors" },
      { pattern: "claude-opus-4-7", reason: "Excellent at critical analysis" },
      { pattern: "deepseek-v4-pro", reason: "Strong OpenCode Go review fallback" },
      { pattern: "qwen3.6-plus", reason: "Strong OpenCode Go structured review fallback" },
      { pattern: "claude-sonnet-4-6", reason: "Good evaluation capability" },
      { pattern: "glm-5.1", reason: "Reasonable OpenCode Go review fallback" },
      { pattern: "minimax-m2.7", reason: "Basic OpenCode Go review fallback" },
      { pattern: "big-pickle", reason: "Free fallback for review" },
    ],
  },
  {
    role: "result-review",
    capability: "critical-review",
    description: "Result review — needs the strongest reasoning to verify execution completeness and quality.",
    recommendations: [
      { pattern: "gpt-5.4", reason: "Strongest reasoning for result verification" },
      { pattern: "claude-opus-4-7", reason: "Excellent at detecting missing or incorrect results" },
      { pattern: "deepseek-v4-pro", reason: "Strong OpenCode Go verification fallback" },
      { pattern: "qwen3.6-plus", reason: "Strong OpenCode Go evaluation fallback" },
      { pattern: "claude-sonnet-4-6", reason: "Good verification capability" },
      { pattern: "glm-5.1", reason: "Reasonable OpenCode Go verification fallback" },
      { pattern: "minimax-m2.7", reason: "Basic OpenCode Go verification fallback" },
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

function sourceRank(origin?: ProviderModel["origin"]): number {
  switch (origin) {
    case "runtime-provider-list":
      return 500;
    case "models-dev-fallback":
      return 300;
    case "credential-provider-fallback":
      return 200;
    case "configured-model":
      return 100;
    case "opencode-json-provider":
      return 50;
    default:
      return 0;
  }
}

function candidateScore(model: ProviderModel): number {
  const baseScore = typeof model.priorityScore === "number"
    ? model.priorityScore
    : sourceRank(model.origin) + (model.connected ? 40 : 0);

  return baseScore + (model.reasoning ? 5 : 0);
}

function chooseBestCandidate(
  availableModels: readonly ProviderModel[],
  pattern: string,
): ProviderModel | undefined {
  return [...availableModels]
    .filter((model) => matchesPattern(model.id, pattern))
    .sort((left, right) => {
      const scoreDiff = candidateScore(right) - candidateScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      return left.id.localeCompare(right.id);
    })[0];
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

  for (const profile of ROLE_MODEL_PROFILES) {
    let bestModel: string | undefined;
    let matchedPattern: string | undefined;
    let matchedCandidate: ProviderModel | undefined;

    for (const recommendation of profile.recommendations) {
      const matchedModel = chooseBestCandidate(availableModels, recommendation.pattern);
      if (matchedModel) {
        bestModel = matchedModel.id;
        matchedPattern = recommendation.pattern;
        matchedCandidate = matchedModel;
        break;
      }
    }

    if (bestModel && matchedPattern) {
      assignments[profile.role] = bestModel;
      resolved.push({
        role: profile.role,
        model: bestModel,
        matchedPattern,
        ...(matchedCandidate?.origin ? { source: matchedCandidate.origin } : {}),
        ...(typeof matchedCandidate?.connected === "boolean" ? { connected: matchedCandidate.connected } : {}),
        ...(typeof matchedCandidate?.priorityScore === "number" ? { priorityScore: matchedCandidate.priorityScore } : {}),
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
      const source = item.source ? `; source=${item.source}` : "";
      const connected = typeof item.connected === "boolean" ? `; connected=${item.connected}` : "";
      lines.push(`  ✓ ${item.role}: ${item.model} (${reason}${source}${connected})`);
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
