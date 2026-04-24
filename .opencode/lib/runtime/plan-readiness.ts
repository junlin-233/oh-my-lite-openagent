import { buildTaskDAG, type TaskDAG, type TaskDispatchConfig } from "./plan-dag.js";

export type PlanReadinessDecision = "execute" | "revise" | "blocked";

export interface PlanReadinessResult {
  executable: boolean;
  decision: PlanReadinessDecision;
  errors: string[];
  warnings: string[];
  maturityLevel?: string;
  status?: string;
  dag?: TaskDAG;
}

const REQUIRED_SECTIONS = [
  "goals",
  "scope_boundaries",
  "acceptance_criteria",
  "phase_plan",
] as const;

export function validatePlanReadiness(
  payload: unknown,
  dispatchInput: Partial<TaskDispatchConfig> = {},
): PlanReadinessResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = normalizePlanPayload(payload);

  const schemaVersion = readField(plan, "plan_schema_version");
  const maturityLevel = readField(plan, "maturity_level");
  const status = readField(plan, "status");

  if (!schemaVersion) {
    errors.push("frontmatter.plan_schema_version is required.");
  } else if (schemaVersion !== "2.1") {
    errors.push("frontmatter.plan_schema_version must be 2.1.");
  }

  if (!maturityLevel) {
    errors.push("frontmatter.maturity_level is required.");
  } else if (!["M0", "M1", "M2", "M3"].includes(maturityLevel)) {
    errors.push("frontmatter.maturity_level must be M0, M1, M2, or M3.");
  }

  if (!status) {
    errors.push("frontmatter.status is required.");
  } else if (!["draft", "reviewed", "blocked"].includes(status)) {
    errors.push("frontmatter.status must be draft, reviewed, or blocked.");
  } else if (status === "blocked") {
    errors.push("blocked plans are not executable.");
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!hasContent(readSection(plan, section))) {
      errors.push(`${section} must be present and non-empty before execution.`);
    }
  }

  if (maturityLevel === "M0" || maturityLevel === "M1") {
    errors.push(`${maturityLevel} plans are not executable.`);
  }

  if (maturityLevel === "M2" && hasBlockingOpenQuestion(plan)) {
    errors.push("M2 plan has open_questions that block the current phase.");
  }

  if (hasUnresolvedMajorReviewFinding(plan)) {
    errors.push("plan has an unresolved major Plan Review finding.");
  }

  if (hasSelfCheckBlocker(plan)) {
    errors.push("plan self-check reports a blocker.");
  }

  let dag: TaskDAG | undefined;
  try {
    dag = buildTaskDAG(plan.payload, dispatchInput);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (payload === plan.payload && typeof payload === "string") {
    warnings.push("raw markdown plans must include a structured plan payload for DAG validation.");
  }

  return {
    executable: errors.length === 0,
    decision: errors.length === 0 ? "execute" : status === "blocked" ? "blocked" : "revise",
    errors,
    warnings,
    ...(maturityLevel ? { maturityLevel } : {}),
    ...(status ? { status } : {}),
    ...(dag ? { dag } : {}),
  };
}

interface NormalizedPlanPayload {
  payload: unknown;
  frontmatter: Record<string, string>;
}

function normalizePlanPayload(payload: unknown): NormalizedPlanPayload {
  if (typeof payload === "string") {
    return {
      payload,
      frontmatter: parseFrontmatter(payload),
    };
  }

  if (isRecord(payload)) {
    const frontmatter = isRecord(payload["frontmatter"]) ? stringifyRecord(payload["frontmatter"]) : {};
    return {
      payload,
      frontmatter: {
        ...frontmatter,
        ...stringifyRecord(payload),
      },
    };
  }

  return {
    payload,
    frontmatter: {},
  };
}

function readField(plan: NormalizedPlanPayload, key: string): string | undefined {
  const value = plan.frontmatter[key];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function readSection(plan: NormalizedPlanPayload, key: string): unknown {
  if (!isRecord(plan.payload)) return undefined;

  const direct = plan.payload[key];
  if (direct !== undefined) return direct;

  const sections = plan.payload["sections"];
  if (isRecord(sections)) return sections[key];

  return undefined;
}

function hasBlockingOpenQuestion(plan: NormalizedPlanPayload): boolean {
  const openQuestions = readSection(plan, "open_questions");

  if (Array.isArray(openQuestions)) {
    return openQuestions.some((question) => (
      isRecord(question) && question["blocks_current_phase"] === true
    ));
  }

  if (typeof openQuestions === "string") {
    return /blocks_current_phase:\s*true/i.test(openQuestions);
  }

  return false;
}

function hasUnresolvedMajorReviewFinding(plan: NormalizedPlanPayload): boolean {
  if (!isRecord(plan.payload)) return false;

  const review = plan.payload["plan_review"] ?? plan.payload["review"];
  return containsUnresolvedMajor(review);
}

function containsUnresolvedMajor(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnresolvedMajor);
  if (!isRecord(value)) return false;

  if (
    value["severity"] === "major" &&
    value["resolved"] !== true &&
    value["decision"] !== "pass"
  ) {
    return true;
  }

  return Object.values(value).some(containsUnresolvedMajor);
}

function hasSelfCheckBlocker(plan: NormalizedPlanPayload): boolean {
  if (!isRecord(plan.payload)) return false;

  const selfCheck = plan.payload["self_check"];
  if (!isRecord(selfCheck)) return false;

  return selfCheck["passed"] === false || selfCheck["blocked"] === true;
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && trimmed !== "Unknown Yet";
  }

  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;

  return value !== undefined && value !== null;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};

  const result: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match?.[1]) result[match[1]] = match[2]?.trim() ?? "";
  }

  return result;
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number") {
      result[key] = String(item);
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
