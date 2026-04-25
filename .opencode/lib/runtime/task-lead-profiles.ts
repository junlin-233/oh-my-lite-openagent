/**
 * Task Lead profile dispatch for Oh My Lite OpenAgent.
 *
 * The lite runtime keeps a single hidden `task-lead` agent. Profiles are a
 * lightweight category layer that maps plan.subtasks[].attributes to dispatch
 * metadata: profile name, prompt append, model fallback patterns, and optional
 * recommended models selected from the imported provider pool.
 */

export interface ProviderModelLike {
  id: string;
}

export interface TaskLeadModelPattern {
  pattern: string;
  reason: string;
}

export interface TaskLeadProfile {
  name: string;
  description: string;
  attributes: readonly string[];
  fallbackPatterns: readonly TaskLeadModelPattern[];
  promptAppend?: string;
}

export interface TaskLeadProfileDispatchConfig {
  defaultProfile: string;
  attributeProfileMap: Record<string, string>;
  attributePriority: string[];
  profileModelMap: Record<string, string>;
  profileFallbackModelMap: Record<string, string[]>;
  availableModels: ProviderModelLike[];
}

export interface TaskLeadProfileSelection {
  profile: string;
  matchedAttribute?: string;
  recommendedModel?: string;
  fallbackChain?: string[];
  fallbackPatterns?: string[];
  promptAppend?: string;
}

export interface AutoTaskLeadProfileModelResult {
  assignments: Record<string, string>;
  resolved: Array<{
    profile: string;
    model: string;
    matchedPattern: string;
  }>;
  unresolved: Array<{
    profile: string;
  }>;
}

export const DEFAULT_TASK_LEAD_PROFILES: readonly TaskLeadProfile[] = [
  {
    name: "quick",
    description: "Small, low-risk mechanical execution where latency and cost matter.",
    attributes: ["quick"],
    fallbackPatterns: [
      { pattern: "gpt-5.4-mini", reason: "Fast low-cost execution" },
      { pattern: "claude-haiku", reason: "Very fast lightweight execution" },
      { pattern: "gemini-3-flash", reason: "Fast flash-class execution" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed subscription fallback" },
      { pattern: "big-pickle", reason: "Free fallback" },
    ],
    promptAppend: "Prefer minimal, targeted edits and avoid broad refactors.",
  },
  {
    name: "code",
    description: "Implementation, refactoring, tests, and bounded bug fixes.",
    attributes: ["code"],
    fallbackPatterns: [
      { pattern: "claude-sonnet", reason: "Strong coding execution with good context handling" },
      { pattern: "kimi-k2", reason: "Good implementation capability" },
      { pattern: "gpt-5.4", reason: "Strong code generation and tool use" },
      { pattern: "gpt-5.3-codex", reason: "Coding-focused fallback" },
      { pattern: "minimax-m2", reason: "Budget implementation fallback" },
    ],
    promptAppend: "Focus on correct implementation, tests, and minimal scoped changes.",
  },
  {
    name: "research",
    description: "Repository or external API understanding before bounded execution.",
    attributes: ["research", "docs"],
    fallbackPatterns: [
      { pattern: "gpt-5.4-mini", reason: "Fast research and summarization" },
      { pattern: "minimax-m2.7-highspeed", reason: "High-speed lookup" },
      { pattern: "claude-haiku", reason: "Fast documentation comprehension" },
      { pattern: "gemini-3-flash", reason: "Fast broad-context research" },
    ],
    promptAppend: "Prioritize checked evidence and concise handoff notes.",
  },
  {
    name: "writing",
    description: "Documentation, README, migration notes, and user-facing prose.",
    attributes: ["writing"],
    fallbackPatterns: [
      { pattern: "gemini-3-flash", reason: "Fast drafting and editing" },
      { pattern: "kimi-k2", reason: "Good structured writing fallback" },
      { pattern: "claude-sonnet", reason: "High-quality prose and documentation" },
      { pattern: "minimax-m2", reason: "Budget writing fallback" },
    ],
    promptAppend: "Optimize for clear, accurate prose while preserving repository terminology.",
  },
  {
    name: "visual",
    description: "UI, screenshots, multimodal inspection, and visual verification.",
    attributes: ["multimodal", "visual"],
    fallbackPatterns: [
      { pattern: "gemini-3.1-pro", reason: "Strong multimodal and visual reasoning" },
      { pattern: "gpt-5.4", reason: "Strong general reasoning fallback" },
      { pattern: "claude-opus", reason: "Strong critical reasoning if vision path is available" },
      { pattern: "glm-5", reason: "Capable fallback" },
    ],
    promptAppend: "Account for visual/UI behavior and call out any missing visual evidence.",
  },
  {
    name: "deep",
    description: "Large-context or difficult execution that needs stronger reasoning.",
    attributes: ["deep", "large-context"],
    fallbackPatterns: [
      { pattern: "gpt-5.5", reason: "Strongest deep execution profile" },
      { pattern: "claude-opus", reason: "Excellent deep reasoning" },
      { pattern: "gemini-3.1-pro", reason: "Long-context reasoning fallback" },
      { pattern: "gpt-5.4", reason: "Strong reasoning fallback" },
    ],
    promptAppend: "Work carefully through dependencies and preserve all acceptance criteria.",
  },
  {
    name: "risk-high",
    description: "Security, permission, migration, data-loss, or architecture-sensitive changes.",
    attributes: ["risk-high", "security", "migration"],
    fallbackPatterns: [
      { pattern: "gpt-5.4", reason: "Strong critical reasoning for risky changes" },
      { pattern: "claude-opus", reason: "Excellent risk analysis" },
      { pattern: "gemini-3.1-pro", reason: "Strong structured evaluation fallback" },
    ],
    promptAppend: "Treat this as high-risk work: preserve invariants and surface blockers instead of guessing.",
  },
] as const;

export const DEFAULT_TASK_LEAD_ATTRIBUTE_PRIORITY = [
  "risk-high",
  "security",
  "migration",
  "multimodal",
  "visual",
  "deep",
  "large-context",
  "code",
  "research",
  "writing",
  "docs",
  "quick",
] as const;

export const DEFAULT_TASK_LEAD_PROFILE_NAME = "code";

export function buildDefaultAttributeProfileMap(
  profiles: readonly TaskLeadProfile[] = DEFAULT_TASK_LEAD_PROFILES,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const profile of profiles) {
    for (const attribute of profile.attributes) {
      if (!map[attribute]) map[attribute] = profile.name;
    }
  }

  return map;
}

export function normalizeTaskLeadProfileDispatchConfig(
  input: Partial<TaskLeadProfileDispatchConfig> = {},
): TaskLeadProfileDispatchConfig {
  return {
    defaultProfile: input.defaultProfile ?? DEFAULT_TASK_LEAD_PROFILE_NAME,
    attributeProfileMap: {
      ...buildDefaultAttributeProfileMap(),
      ...(input.attributeProfileMap ?? {}),
    },
    attributePriority: input.attributePriority ?? [...DEFAULT_TASK_LEAD_ATTRIBUTE_PRIORITY],
    profileModelMap: input.profileModelMap ?? {},
    profileFallbackModelMap: input.profileFallbackModelMap ?? {},
    availableModels: input.availableModels ?? [],
  };
}

export function resolveTaskLeadProfileDispatch(
  attributes: readonly string[],
  input: Partial<TaskLeadProfileDispatchConfig> = {},
): TaskLeadProfileSelection {
  const config = normalizeTaskLeadProfileDispatchConfig(input);
  const attributeSet = new Set(attributes);
  const matchedAttribute = config.attributePriority.find((attribute) => attributeSet.has(attribute));
  const profileName = matchedAttribute
    ? config.attributeProfileMap[matchedAttribute] ?? config.defaultProfile
    : config.defaultProfile;
  const profile = findTaskLeadProfile(profileName);
  const configuredModel = config.profileModelMap[profileName];
  const configuredFallback = config.profileFallbackModelMap[profileName] ?? [];
  const patternFallback = profile
    ? resolveFallbackChainFromPatterns(profile, config.availableModels)
    : [];
  const fallbackChain = dedupeStrings([
    ...(configuredModel ? [configuredModel] : []),
    ...configuredFallback,
    ...patternFallback,
  ]);
  const recommendedModel = configuredModel ?? fallbackChain[0];

  return {
    profile: profileName,
    ...(matchedAttribute ? { matchedAttribute } : {}),
    ...(recommendedModel ? { recommendedModel } : {}),
    ...(fallbackChain.length > 0 ? { fallbackChain } : {}),
    ...(profile ? { fallbackPatterns: profile.fallbackPatterns.map((item) => item.pattern) } : {}),
    ...(profile?.promptAppend ? { promptAppend: profile.promptAppend } : {}),
  };
}

export function resolveAutoTaskLeadProfileModels(
  availableModels: readonly ProviderModelLike[],
): AutoTaskLeadProfileModelResult {
  const assignments: Record<string, string> = {};
  const resolved: AutoTaskLeadProfileModelResult["resolved"] = [];
  const unresolved: AutoTaskLeadProfileModelResult["unresolved"] = [];

  for (const profile of DEFAULT_TASK_LEAD_PROFILES) {
    const match = findFirstMatchingModel(profile, availableModels);

    if (match) {
      assignments[profile.name] = match.model;
      resolved.push({
        profile: profile.name,
        model: match.model,
        matchedPattern: match.pattern,
      });
    } else {
      unresolved.push({ profile: profile.name });
    }
  }

  return { assignments, resolved, unresolved };
}

export function formatTaskLeadProfileModelReport(
  result: AutoTaskLeadProfileModelResult,
): string {
  const lines = [
    "Task Lead profile model recommendations:",
  ];

  if (result.resolved.length > 0) {
    for (const item of result.resolved) {
      const profile = findTaskLeadProfile(item.profile);
      const reason = profile?.fallbackPatterns.find((entry) => entry.pattern === item.matchedPattern)?.reason ??
        "Best available profile match";
      lines.push(`  ✓ ${item.profile}: ${item.model} (${reason})`);
    }
  } else {
    lines.push("  <none resolved>");
  }

  if (result.unresolved.length > 0) {
    lines.push("", "Unresolved Task Lead profiles:");
    for (const item of result.unresolved) {
      lines.push(`  ✗ ${item.profile}: no matching model found`);
    }
  }

  return lines.join("\n");
}

export function findTaskLeadProfile(profileName: string): TaskLeadProfile | undefined {
  return DEFAULT_TASK_LEAD_PROFILES.find((profile) => profile.name === profileName);
}

export function isKnownTaskLeadProfile(profileName: string): boolean {
  return findTaskLeadProfile(profileName) !== undefined;
}

function resolveFallbackChainFromPatterns(
  profile: TaskLeadProfile,
  availableModels: readonly ProviderModelLike[],
): string[] {
  if (availableModels.length === 0) return [];

  return dedupeStrings(profile.fallbackPatterns.flatMap((entry) => (
    availableModels
      .filter((model) => matchesPattern(model.id, entry.pattern))
      .map((model) => model.id)
  )));
}

function findFirstMatchingModel(
  profile: TaskLeadProfile,
  availableModels: readonly ProviderModelLike[],
): { model: string; pattern: string } | undefined {
  for (const entry of profile.fallbackPatterns) {
    const model = availableModels.find((item) => matchesPattern(item.id, entry.pattern));
    if (model) return { model: model.id, pattern: entry.pattern };
  }

  return undefined;
}

function matchesPattern(modelId: string, pattern: string): boolean {
  return modelId.toLowerCase().includes(pattern.toLowerCase());
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}
