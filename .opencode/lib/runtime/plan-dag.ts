import {
  TASK_DAG_DEFAULT_CONCURRENCY,
  TASK_DAG_MAX_CONCURRENCY,
  TASK_DAG_MIN_CONCURRENCY,
} from "../contracts.js";

export interface PlanSubtask {
  id: string;
  depends_on: string[];
  attributes: string[];
  deliverable: string;
  description: string;
}

export interface PlanFilePayload {
  plan: {
    subtasks: PlanSubtask[];
  };
}

export interface TaskDispatchConfig {
  concurrency: number;
  defaultProfile: string;
  attributeModelMap: Record<string, string>;
  attributePriority: string[];
}

export interface TaskDispatchSelection {
  profile: string;
  matchedAttribute?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  subtasks: PlanSubtask[];
}

export interface TaskDAGNode extends PlanSubtask {
  dependents: string[];
  dispatch: TaskDispatchSelection;
}

export interface TaskDAG {
  nodes: TaskDAGNode[];
  waves: string[][];
  concurrency: number;
}

export const DEFAULT_TASK_DISPATCH_CONFIG: TaskDispatchConfig = {
  concurrency: TASK_DAG_DEFAULT_CONCURRENCY,
  defaultProfile: "default",
  attributeModelMap: {
    code: "code",
    docs: "research",
    multimodal: "multimodal",
    research: "research",
  },
  attributePriority: ["multimodal", "code", "research", "docs"],
};

export function normalizeTaskDispatchConfig(
  input: Partial<TaskDispatchConfig> = {},
): TaskDispatchConfig {
  const concurrency = input.concurrency ?? DEFAULT_TASK_DISPATCH_CONFIG.concurrency;

  if (
    !Number.isInteger(concurrency) ||
    concurrency < TASK_DAG_MIN_CONCURRENCY ||
    concurrency > TASK_DAG_MAX_CONCURRENCY
  ) {
    throw new Error(
      `Task DAG concurrency must be an integer from ${TASK_DAG_MIN_CONCURRENCY} to ${TASK_DAG_MAX_CONCURRENCY}.`,
    );
  }

  const attributeModelMap = {
    ...DEFAULT_TASK_DISPATCH_CONFIG.attributeModelMap,
    ...(input.attributeModelMap ?? {}),
  };

  return {
    concurrency,
    defaultProfile: input.defaultProfile ?? DEFAULT_TASK_DISPATCH_CONFIG.defaultProfile,
    attributeModelMap,
    attributePriority: input.attributePriority ?? DEFAULT_TASK_DISPATCH_CONFIG.attributePriority,
  };
}

export function validatePlanPayload(payload: unknown): PlanValidationResult {
  const errors: string[] = [];
  const subtasks = extractSubtasks(payload, errors);
  const ids = new Set<string>();

  for (const [index, subtask] of subtasks.entries()) {
    const prefix = `plan.subtasks[${index}]`;

    if (subtask.id.trim() === "") {
      errors.push(`${prefix}.id must be a non-empty string.`);
    }

    if (ids.has(subtask.id)) {
      errors.push(`${prefix}.id duplicates ${subtask.id}.`);
    }

    ids.add(subtask.id);

    if (subtask.deliverable.trim() === "") {
      errors.push(`${prefix}.deliverable must be a non-empty string.`);
    }

    if (subtask.description.trim() === "") {
      errors.push(`${prefix}.description must be a non-empty string.`);
    }
  }

  for (const subtask of subtasks) {
    for (const dependency of subtask.depends_on) {
      if (!ids.has(dependency)) {
        errors.push(`Subtask ${subtask.id} depends on unknown subtask ${dependency}.`);
      }
    }
  }

  errors.push(...detectCycles(subtasks));

  return {
    valid: errors.length === 0,
    errors,
    subtasks,
  };
}

export function buildTaskDAG(
  payload: unknown,
  dispatchInput: Partial<TaskDispatchConfig> = {},
): TaskDAG {
  const validation = validatePlanPayload(payload);

  if (!validation.valid) {
    throw new Error(`Invalid plan payload:\n${validation.errors.join("\n")}`);
  }

  const dispatchConfig = normalizeTaskDispatchConfig(dispatchInput);
  const dependents = new Map<string, string[]>();

  for (const subtask of validation.subtasks) {
    dependents.set(subtask.id, []);
  }

  for (const subtask of validation.subtasks) {
    for (const dependency of subtask.depends_on) {
      dependents.get(dependency)?.push(subtask.id);
    }
  }

  const nodes = validation.subtasks.map((subtask) => ({
    ...subtask,
    dependents: [...(dependents.get(subtask.id) ?? [])].sort(),
    dispatch: resolveDispatchProfile(subtask.attributes, dispatchConfig),
  }));

  return {
    nodes,
    waves: inferExecutionWaves(validation.subtasks),
    concurrency: dispatchConfig.concurrency,
  };
}

export function resolveDispatchProfile(
  attributes: readonly string[],
  input: Partial<TaskDispatchConfig> = {},
): TaskDispatchSelection {
  const config = normalizeTaskDispatchConfig(input);
  const attributeSet = new Set(attributes);

  for (const attribute of config.attributePriority) {
    const profile = config.attributeModelMap[attribute];

    if (attributeSet.has(attribute) && profile) {
      return {
        profile,
        matchedAttribute: attribute,
      };
    }
  }

  return { profile: config.defaultProfile };
}

export function inferExecutionWaves(subtasks: readonly PlanSubtask[]): string[][] {
  const remainingDependencies = new Map(
    subtasks.map((subtask) => [subtask.id, new Set(subtask.depends_on)]),
  );
  const waves: string[][] = [];

  while (remainingDependencies.size > 0) {
    const ready = [...remainingDependencies.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort();

    if (ready.length === 0) {
      throw new Error("Cannot infer execution waves for a cyclic plan DAG.");
    }

    waves.push(ready);

    for (const id of ready) {
      remainingDependencies.delete(id);
    }

    for (const dependencies of remainingDependencies.values()) {
      for (const id of ready) dependencies.delete(id);
    }
  }

  return waves;
}

function extractSubtasks(payload: unknown, errors: string[]): PlanSubtask[] {
  if (!isRecord(payload)) {
    errors.push("payload must be an object with plan.subtasks.");
    return [];
  }

  const plan = payload["plan"];
  if (!isRecord(plan)) {
    errors.push("payload.plan must be an object.");
    return [];
  }

  const rawSubtasks = plan["subtasks"];
  if (!Array.isArray(rawSubtasks)) {
    errors.push("payload.plan.subtasks must be an array.");
    return [];
  }

  return rawSubtasks.flatMap((rawSubtask, index) => {
    const prefix = `plan.subtasks[${index}]`;

    if (!isRecord(rawSubtask)) {
      errors.push(`${prefix} must be an object.`);
      return [];
    }

    const id = readString(rawSubtask, "id", prefix, errors);
    const dependsOn = readStringArray(rawSubtask, "depends_on", prefix, errors);
    const attributes = readStringArray(rawSubtask, "attributes", prefix, errors);
    const deliverable = readString(rawSubtask, "deliverable", prefix, errors);
    const description = readString(rawSubtask, "description", prefix, errors);

    if (
      id === undefined ||
      dependsOn === undefined ||
      attributes === undefined ||
      deliverable === undefined ||
      description === undefined
    ) {
      return [];
    }

    return [{
      id,
      depends_on: dependsOn,
      attributes,
      deliverable,
      description,
    }];
  });
}

function readString(
  value: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): string | undefined {
  const item = value[key];

  if (typeof item !== "string") {
    errors.push(`${prefix}.${key} must be a string.`);
    return undefined;
  }

  return item;
}

function readStringArray(
  value: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): string[] | undefined {
  const item = value[key];

  if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) {
    errors.push(`${prefix}.${key} must be an array of strings.`);
    return undefined;
  }

  return item;
}

function detectCycles(subtasks: readonly PlanSubtask[]): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(subtasks.map((subtask) => [subtask.id, subtask]));
  const errors: string[] = [];

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) return;

    if (visiting.has(id)) {
      errors.push(`Plan DAG contains a cycle: ${[...path, id].join(" -> ")}.`);
      return;
    }

    const subtask = byId.get(id);
    if (!subtask) return;

    visiting.add(id);

    for (const dependency of subtask.depends_on) {
      visit(dependency, [...path, id]);
    }

    visiting.delete(id);
    visited.add(id);
  }

  for (const subtask of subtasks) {
    visit(subtask.id, []);
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
