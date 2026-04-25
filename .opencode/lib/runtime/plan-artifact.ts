import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const LITE_AGENT_DIR = ".liteagent";
export const PLAN_ARTIFACT_DIR = `${LITE_AGENT_DIR}/plans`;
export const PLAN_INDEX_FILE = `${LITE_AGENT_DIR}/plan-index.jsonl`;

export interface WritePlanArtifactInput {
  projectRoot: string;
  title: string;
  markdown: string;
  planId?: string;
  artifactKind?: "plan-skeleton" | "detailed-plan";
  status?: "draft" | "reviewed" | "blocked";
  maturityLevel?: string;
  generatedBy?: string;
  requestedPath?: string;
  overwrite?: boolean;
  now?: Date;
}

export interface PlanArtifactWriteResult {
  planId: string;
  title: string;
  relativePath: string;
  path: string;
  indexPath: string;
  bytes: number;
  overwritten: boolean;
}

export async function writePlanArtifact(input: WritePlanArtifactInput): Promise<PlanArtifactWriteResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const title = input.title.trim();
  const markdown = input.markdown.trimEnd();

  if (!title) throw new Error("plan artifact title is required.");
  if (!markdown) throw new Error("plan artifact markdown is required.");

  const now = input.now ?? new Date();
  const datePrefix = now.toISOString().slice(0, 10);
  const planId = sanitizeSlug(input.planId ?? title);
  const relativePath = resolvePlanArtifactRelativePath(input.requestedPath, datePrefix, planId);
  const absolutePath = path.resolve(projectRoot, relativePath);
  const plansDir = path.resolve(projectRoot, PLAN_ARTIFACT_DIR);

  if (!isInsideDirectory(absolutePath, plansDir)) {
    throw new Error(`plan artifact path must stay under ${PLAN_ARTIFACT_DIR}.`);
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });

  let overwritten = false;
  if (!input.overwrite) {
    try {
      await readFile(absolutePath, "utf8");
      throw new Error(`plan artifact already exists: ${relativePath}`);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  } else {
    try {
      await readFile(absolutePath, "utf8");
      overwritten = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }

  const content = `${markdown}\n`;
  await writeFile(absolutePath, content);

  const indexPath = path.resolve(projectRoot, PLAN_INDEX_FILE);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await appendFile(indexPath, `${JSON.stringify({
    plan_id: planId,
    title,
    path: relativePath,
    artifact_kind: input.artifactKind ?? "plan-skeleton",
    status: input.status ?? "draft",
    maturity_level: input.maturityLevel,
    generated_by: input.generatedBy,
    updated_at: now.toISOString(),
    overwritten,
  })}\n`);

  return {
    planId,
    title,
    relativePath,
    path: absolutePath,
    indexPath,
    bytes: Buffer.byteLength(content),
    overwritten,
  };
}

export function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "plan";
}

function resolvePlanArtifactRelativePath(
  requestedPath: string | undefined,
  datePrefix: string,
  planId: string,
): string {
  if (!requestedPath || requestedPath.trim() === "") {
    return `${PLAN_ARTIFACT_DIR}/${datePrefix}-${planId}.md`;
  }

  const normalized = requestedPath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (path.posix.isAbsolute(normalized)) {
    throw new Error("plan artifact path must be relative.");
  }
  if (normalized.includes("\0")) {
    throw new Error("plan artifact path contains an invalid character.");
  }
  if (path.posix.normalize(normalized) !== normalized || normalized.startsWith("../")) {
    throw new Error("plan artifact path must be normalized and cannot traverse directories.");
  }
  if (!normalized.startsWith(`${PLAN_ARTIFACT_DIR}/`)) {
    throw new Error(`plan artifact path must start with ${PLAN_ARTIFACT_DIR}/.`);
  }
  if (!normalized.endsWith(".md")) {
    throw new Error("plan artifact path must end with .md.");
  }

  return normalized;
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
