import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OPENPLAN_DIR = "openplan";
export const OPENPLAN_INDEX_FILE = `${OPENPLAN_DIR}/index.jsonl`;

const PLAN_ID_PATTERN = /^[a-z0-9]{8}$/;
const SESSION_KEY_PATTERN = /^\d{8}-\d{4}-[a-z0-9]{8}$/;
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export type PlanArtifactOperation = "create" | "update";
export type PlanArtifactStatus = "draft" | "reviewed" | "blocked" | "superseded";

export interface WritePlanArtifactInput {
  projectRoot: string;
  action: "write";
  operation?: PlanArtifactOperation;
  title?: string;
  markdown?: string;
  content?: string;
  sessionKey: string;
  sessionStartedAt: string;
  filenameHint?: string;
  generatedBy: string;
  planId?: string;
  status?: PlanArtifactStatus;
  maturityLevel?: string;
  targetPlanRef?: string;
  sourceSessionKey?: string;
  sourcePlanRef?: string;
  replacesSessionKey?: string;
  replacesPlanRef?: string;
  now?: Date;
  configDir?: string;
  testFaults?: {
    failPlanWrite?: boolean;
    failUpdateReplace?: boolean;
    failReplacementTargetWrite?: boolean;
    failIndexWriteOnce?: boolean;
    failRebuild?: boolean;
  };
}

export interface OpenPlanFrontmatter {
  plan_id: string;
  title: string;
  session_key: string;
  session_started_at: string;
  created_at: string;
  updated_at: string;
  operation: PlanArtifactOperation;
  status: PlanArtifactStatus;
  generated_by: string;
  filename: string;
  path: string;
  maturity_level?: string;
  source_session_key?: string;
  source_plan_ref?: string;
  replaces_session_key?: string;
  replaces_plan_ref?: string;
}

export interface CurrentStateIndexRecord {
  plan_id: string;
  title: string;
  session_key: string;
  session_started_at: string;
  created_at: string;
  updated_at: string;
  operation: PlanArtifactOperation;
  status: PlanArtifactStatus;
  generated_by: string;
  path: string;
  filename: string;
  maturity_level?: string;
  source_session_key?: string;
  source_plan_ref?: string;
  replaces_session_key?: string;
  replaces_plan_ref?: string;
}

export interface PlanArtifactWriteResult {
  ok: true;
  planId: string;
  title: string;
  path: string;
  absolutePath: string;
  indexPath: string;
  absoluteIndexPath: string;
  sessionKey: string;
  bytes: number;
  status: PlanArtifactStatus;
  operation: PlanArtifactOperation;
  rebuildTriggered: boolean;
  indexStatus: "written" | "rebuild_succeeded";
}

export type RebuildOpenPlanIndexMode = "manual-rebuild" | "self-check-rebuild" | "write-recovery";

export interface RebuildOpenPlanIndexInput {
  configDir?: string;
  mode?: RebuildOpenPlanIndexMode;
  generatedBy?: string;
  reason?: string;
  testFaults?: WritePlanArtifactInput["testFaults"];
}

export interface RebuildOpenPlanIndexResult {
  ok: true;
  indexPath: string;
  scannedFileCount: number;
  rebuiltRecordCount: number;
  status: "rebuilt" | "empty";
  mode: RebuildOpenPlanIndexMode;
}

export interface OpenPlanSelfCheckResult {
  ok: true;
  indexPath: string;
  scannedFileCount: number;
  rebuiltRecordCount: number;
  status: "healthy" | "repaired" | "empty";
  mode: "self-check" | "self-check-rebuild";
}

interface OpenPlanScanResult {
  records: CurrentStateIndexRecord[];
  scannedFileCount: number;
  invalidFiles: Array<{ path: string; errorMessage: string }>;
}

class OpenPlanRebuildError extends Error {
  readonly indexPath: string;
  readonly scannedFileCount: number;
  readonly invalidFileCount: number;
  readonly errorMessage: string;

  constructor(input: {
    code: string;
    message: string;
    indexPath: string;
    scannedFileCount: number;
    invalidFileCount: number;
  }) {
    super(`${input.code}: ${input.message}`);
    this.name = "OpenPlanRebuildError";
    this.indexPath = input.indexPath;
    this.scannedFileCount = input.scannedFileCount;
    this.invalidFileCount = input.invalidFileCount;
    this.errorMessage = input.message;
  }
}

interface PlanDocumentParts {
  frontmatter: Record<string, string>;
  body: string;
}

export async function writePlanArtifact(input: WritePlanArtifactInput): Promise<PlanArtifactWriteResult> {
  if (input.action !== "write") {
    throw new Error("PLANART_ERR_UNKNOWN_ACTION: bounded_lite_plan_artifact action must be write.");
  }

  const operation = input.operation ?? "create";
  if (operation !== "create" && operation !== "update") {
    throw new Error("PLANART_ERR_UNSUPPORTED_OPERATION: operation must be create or update.");
  }

  if (typeof input.generatedBy !== "string" || input.generatedBy.trim() === "") {
    throw new Error("PLANART_ERR_MISSING_GENERATED_BY: generatedBy is required.");
  }

  const sessionKey = assertSessionKey(input.sessionKey);
  const sessionStartedAt = toUtcIsoString(input.sessionStartedAt, "sessionStartedAt");

  return operation === "create"
    ? writeCreatePlanArtifact(input, sessionKey, sessionStartedAt)
    : writeUpdatePlanArtifact(input, sessionKey, sessionStartedAt);
}

function writeCreatePlanArtifact(
  input: WritePlanArtifactInput,
  sessionKey: string,
  sessionStartedAt: string,
): Promise<PlanArtifactWriteResult> {
  const title = input.title?.trim() ?? "";
  const markdown = (input.markdown ?? input.content ?? "").trimEnd();

  if (!title) throw new Error("PLANART_ERR_MISSING_TITLE: plan artifact title is required.");
  if (!markdown) throw new Error("PLANART_ERR_MISSING_MARKDOWN: plan artifact markdown is required.");
  if (!input.filenameHint) throw new Error("PLANART_ERR_MISSING_FILENAME_HINT: filenameHint is required.");

  const status = input.status ?? "draft";
  if (status !== "draft" && status !== "reviewed" && status !== "blocked") {
    throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: create supports draft, reviewed, or blocked.");
  }
  if (!input.sourcePlanRef && input.sourceSessionKey) {
    throw new Error("PLANART_ERR_SOURCE_PLAN_REF_REQUIRED: sourceSessionKey requires sourcePlanRef.");
  }
  if (!input.replacesPlanRef && input.replacesSessionKey) {
    throw new Error("PLANART_ERR_REPLACEMENT_TARGET_MISSING: replacesSessionKey requires replacesPlanRef.");
  }

  return persistCreateArtifact({
    projectRoot: input.projectRoot,
    action: input.action,
    operation: "create",
    title,
    markdown,
    filenameHint: assertFilenameHint(input.filenameHint),
    sessionKey,
    sessionStartedAt,
    generatedBy: input.generatedBy,
    ...(input.planId ? { planId: input.planId } : {}),
    ...(input.maturityLevel ? { maturityLevel: input.maturityLevel } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.configDir ? { configDir: input.configDir } : {}),
    ...(input.testFaults ? { testFaults: input.testFaults } : {}),
    ...(input.sourcePlanRef ? { sourcePlanRef: input.sourcePlanRef } : {}),
    ...(input.sourceSessionKey ? { sourceSessionKey: input.sourceSessionKey } : {}),
    ...(input.replacesPlanRef ? { replacesPlanRef: input.replacesPlanRef } : {}),
    ...(input.replacesSessionKey ? { replacesSessionKey: input.replacesSessionKey } : {}),
    status,
  });
}

async function persistCreateArtifact(
  input: WritePlanArtifactInput & {
    title: string;
    markdown: string;
    filenameHint: string;
    sessionKey: string;
    sessionStartedAt: string;
    status: "draft" | "reviewed" | "blocked";
  },
): Promise<PlanArtifactWriteResult> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const planId = input.planId ? assertPlanId(input.planId) : createShortId();
  const openPlanRoot = resolveOpenPlanRoot(input.configDir);
  const sessionDir = path.join(openPlanRoot, input.sessionKey);
  const finalFilename = await resolveCreateOnlyFilename(sessionDir, input.filenameHint);
  const relativePath = normalizeRelativePath(path.posix.join(input.sessionKey, finalFilename));
  const absolutePath = path.join(openPlanRoot, input.sessionKey, finalFilename);
  const provenance = input.sourcePlanRef
    ? await resolveCreateProvenance(openPlanRoot, input.sourcePlanRef, input.sessionKey, input.sourceSessionKey)
    : undefined;
  const replacement = input.replacesPlanRef
    ? await resolveReplacementTarget(openPlanRoot, input.replacesPlanRef, input.replacesSessionKey)
    : undefined;

  const frontmatter: OpenPlanFrontmatter = {
    plan_id: planId,
    title: input.title,
    session_key: input.sessionKey,
    session_started_at: input.sessionStartedAt,
    created_at: createdAt,
    updated_at: createdAt,
    operation: "create",
    status: input.status,
    generated_by: input.generatedBy.trim(),
    filename: finalFilename,
    path: relativePath,
    ...(input.maturityLevel ? { maturity_level: input.maturityLevel } : {}),
    ...(provenance
      ? {
        source_session_key: provenance.source_session_key,
        source_plan_ref: provenance.source_plan_ref,
      }
      : {}),
    ...(replacement
      ? {
        replaces_session_key: replacement.targetFrontmatter.session_key,
        replaces_plan_ref: replacement.targetFrontmatter.path,
      }
      : {}),
  };

  const planContent = buildPlanDocument(frontmatter, input.markdown);

  await mkdir(openPlanRoot, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  try {
    if (input.testFaults?.failPlanWrite) {
      await writeFile(absolutePath, "partial\n");
      throw new Error("injected plan write failure");
    }

    await writeFile(absolutePath, planContent, { flag: "wx" });
  } catch (error) {
    await cleanupFailedPlanWrite(absolutePath, error);
    throw new Error(`PLANART_ERR_PLAN_WRITE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (replacement) {
    let updatedReplacementTargetRecord: CurrentStateIndexRecord | undefined;
    try {
      if (input.testFaults?.failReplacementTargetWrite) {
        throw new Error("injected replacement target write failure");
      }

      updatedReplacementTargetRecord = await writeSupersededReplacementTarget(replacement, {
        ...(input.testFaults ? { testFaults: input.testFaults } : {}),
      });

      return finalizeArtifactWrite({
        openPlanRoot,
        frontmatter,
        planContent,
        absolutePath,
        sessionKey: input.sessionKey,
        testFaults: input.testFaults,
        additionalRecords: updatedReplacementTargetRecord ? [updatedReplacementTargetRecord] : [],
      });
    } catch (error) {
      throw new Error([
        "PLANART_ERR_REPLACEMENT_TARGET_WRITE_FAILED:",
        `new plan already written: ${relativePath}`,
        "replacement target not successfully superseded",
        "current replacement not completed",
        error instanceof Error ? error.message : String(error),
      ].join("; "));
    }
  }

  return finalizeArtifactWrite({
    openPlanRoot,
    frontmatter,
    planContent,
    absolutePath,
    sessionKey: input.sessionKey,
    testFaults: input.testFaults,
    additionalRecords: [],
  });
}

async function writeUpdatePlanArtifact(
  input: WritePlanArtifactInput,
  sessionKey: string,
  sessionStartedAt: string,
): Promise<PlanArtifactWriteResult> {
  if (input.sourcePlanRef || input.sourceSessionKey) {
    throw new Error("PLANART_ERR_UPDATE_SOURCE_FORBIDDEN: update does not accept sourcePlanRef or sourceSessionKey.");
  }

  const openPlanRoot = resolveOpenPlanRoot(input.configDir);
  const normalizedTargetPlanRef = input.targetPlanRef ? assertTargetPlanRef(input.targetPlanRef, sessionKey) : undefined;
  const targetRecord = normalizedTargetPlanRef
    ? await resolveExplicitUpdateTarget(openPlanRoot, normalizedTargetPlanRef, sessionKey)
    : await resolveDefaultUpdateTarget(openPlanRoot, sessionKey);

  const absolutePath = path.join(openPlanRoot, ...targetRecord.path.split("/"));
  const originalContent = await readExistingPlanArtifact(absolutePath, targetRecord.path);
  const original = splitPlanDocument(originalContent);
  const originalFrontmatter = frontmatterToOpenPlanFrontmatter(original.frontmatter);

  if (originalFrontmatter.session_key !== sessionKey) {
    throw new Error("PLANART_ERR_CROSS_SESSION_UPDATE: update target must stay within the current session.");
  }
  if (originalFrontmatter.session_started_at !== sessionStartedAt) {
    throw new Error("PLANART_ERR_SESSION_MISMATCH: target plan sessionStartedAt does not match the current session.");
  }

  const nextBody = typeof input.markdown === "string"
    ? input.markdown.trimEnd()
    : typeof input.content === "string"
      ? input.content.trimEnd()
      : original.body;
  const nextTitle = input.title?.trim() ? input.title.trim() : originalFrontmatter.title;
  const nextMaturityLevel = input.maturityLevel ?? originalFrontmatter.maturity_level;

  const hasBodyUpdate = typeof input.markdown === "string" || typeof input.content === "string";
  const hasStatusUpdate = typeof input.status === "string";
  if (!hasBodyUpdate && !hasStatusUpdate) {
    throw new Error("PLANART_ERR_MISSING_UPDATE_PAYLOAD: update requires markdown/content or status.");
  }

  if (hasBodyUpdate && nextBody.trim() === "") {
    throw new Error("PLANART_ERR_MISSING_MARKDOWN: update markdown must not be empty.");
  }

  const nextStatus = resolveUpdateStatus({
    requestedStatus: input.status,
    hasContentUpdate: hasBodyUpdate || (input.title !== undefined && nextTitle !== originalFrontmatter.title) || input.maturityLevel !== undefined,
    currentStatus: originalFrontmatter.status,
  });
  const now = input.now ?? new Date();
  const updatedFrontmatter: OpenPlanFrontmatter = {
    plan_id: originalFrontmatter.plan_id,
    title: nextTitle,
    session_key: originalFrontmatter.session_key,
    session_started_at: originalFrontmatter.session_started_at,
    created_at: originalFrontmatter.created_at,
    updated_at: now.toISOString(),
    operation: "update",
    status: nextStatus,
    generated_by: originalFrontmatter.generated_by,
    filename: originalFrontmatter.filename,
    path: originalFrontmatter.path,
    ...(nextMaturityLevel ? { maturity_level: nextMaturityLevel } : {}),
    ...(originalFrontmatter.source_session_key && originalFrontmatter.source_plan_ref
      ? {
        source_session_key: originalFrontmatter.source_session_key,
        source_plan_ref: originalFrontmatter.source_plan_ref,
      }
      : {}),
    ...(originalFrontmatter.replaces_session_key && originalFrontmatter.replaces_plan_ref
      ? {
        replaces_session_key: originalFrontmatter.replaces_session_key,
        replaces_plan_ref: originalFrontmatter.replaces_plan_ref,
      }
      : {}),
  };
  const updatedContent = buildPlanDocument(updatedFrontmatter, nextBody);

  await safeReplacePlanFile({
    targetPath: absolutePath,
    nextContent: updatedContent,
    fault: input.testFaults?.failUpdateReplace === true,
  });

  return finalizeArtifactWrite({
    openPlanRoot,
    frontmatter: updatedFrontmatter,
    planContent: updatedContent,
    absolutePath,
    sessionKey,
    testFaults: input.testFaults,
    additionalRecords: [],
  });
}

async function finalizeArtifactWrite(input: {
  openPlanRoot: string;
  frontmatter: OpenPlanFrontmatter;
  planContent: string;
  absolutePath: string;
  sessionKey: string;
  testFaults?: WritePlanArtifactInput["testFaults"];
  additionalRecords: CurrentStateIndexRecord[];
}): Promise<PlanArtifactWriteResult> {
  let rebuildTriggered = false;
  let indexStatus: "written" | "rebuild_succeeded" = "written";

  try {
    if (input.testFaults?.failIndexWriteOnce) {
      throw new Error("PLANART_ERR_INDEX_WRITE_FAILED: injected index write failure");
    }

    await rewriteCurrentStateIndex(
      input.openPlanRoot,
      [frontmatterToIndexRecord(input.frontmatter), ...input.additionalRecords],
    );
  } catch (indexError) {
    rebuildTriggered = true;
    indexStatus = "rebuild_succeeded";

    try {
      if (input.testFaults?.failRebuild) {
        throw new Error("injected rebuild failure");
      }

      await rebuildOpenPlanIndex({
        configDir: path.dirname(input.openPlanRoot),
        mode: "write-recovery",
        testFaults: input.testFaults,
      });
    } catch (rebuildError) {
      throw new Error([
        "PLANART_ERR_INDEX_WRITE_FAILED_REBUILD_FAILED:",
        `plan file already written: ${input.frontmatter.path}`,
        `index repair failed: ${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`,
        "requires follow-up repair",
      ].join("; "));
    }

    void indexError;
  }

  return {
    ok: true,
    planId: input.frontmatter.plan_id,
    title: input.frontmatter.title,
    path: input.frontmatter.path,
    absolutePath: input.absolutePath,
    indexPath: OPENPLAN_INDEX_FILE,
    absoluteIndexPath: path.join(input.openPlanRoot, "index.jsonl"),
    sessionKey: input.sessionKey,
    bytes: Buffer.byteLength(input.planContent),
    status: input.frontmatter.status,
    operation: input.frontmatter.operation,
    rebuildTriggered,
    indexStatus,
  };
}

export async function rebuildOpenPlanIndex(input: RebuildOpenPlanIndexInput = {}): Promise<RebuildOpenPlanIndexResult> {
  const openPlanRoot = resolveOpenPlanRoot(input.configDir);
  const indexPath = path.join(openPlanRoot, "index.jsonl");
  const scan = await scanOpenPlanRecords(openPlanRoot);

  if (scan.invalidFiles.length > 0) {
    const firstInvalid = scan.invalidFiles[0];
    throw new OpenPlanRebuildError({
      code: "PLANART_ERR_REBUILD_INVALID_PLAN_FILE",
      message: `invalid plan file: ${firstInvalid?.path ?? "unknown"}; ${firstInvalid?.errorMessage ?? "frontmatter parse failed"}`,
      indexPath,
      scannedFileCount: scan.scannedFileCount,
      invalidFileCount: scan.invalidFiles.length,
    });
  }

  if (input.testFaults?.failRebuild) {
    throw new OpenPlanRebuildError({
      code: "PLANART_ERR_REBUILD_FAILED",
      message: "injected rebuild failure",
      indexPath,
      scannedFileCount: scan.scannedFileCount,
      invalidFileCount: 0,
    });
  }

  try {
    await rewriteCurrentStateIndex(openPlanRoot, scan.records, { replace: true });
  } catch (error) {
    throw new OpenPlanRebuildError({
      code: "PLANART_ERR_REBUILD_FAILED",
      message: error instanceof Error ? error.message : String(error),
      indexPath,
      scannedFileCount: scan.scannedFileCount,
      invalidFileCount: 0,
    });
  }

  return {
    ok: true,
    indexPath: OPENPLAN_INDEX_FILE,
    scannedFileCount: scan.scannedFileCount,
    rebuiltRecordCount: scan.records.length,
    status: scan.records.length === 0 ? "empty" : "rebuilt",
    mode: input.mode ?? "manual-rebuild",
  };
}

export async function ensureOpenPlanIndexHealthyOnce(input: {
  configDir?: string;
  testFaults?: WritePlanArtifactInput["testFaults"];
} = {}): Promise<OpenPlanSelfCheckResult> {
  const openPlanRoot = resolveOpenPlanRoot(input.configDir);
  const indexPath = path.join(openPlanRoot, "index.jsonl");
  const scan = await scanOpenPlanRecords(openPlanRoot);

  if (scan.invalidFiles.length > 0) {
    const firstInvalid = scan.invalidFiles[0];
    throw new OpenPlanRebuildError({
      code: "PLANART_ERR_SELF_CHECK_INVALID_PLAN_FILE",
      message: `index self-check repair failed; invalid plan file: ${firstInvalid?.path ?? "unknown"}; ${firstInvalid?.errorMessage ?? "frontmatter parse failed"}; requires follow-up repair`,
      indexPath,
      scannedFileCount: scan.scannedFileCount,
      invalidFileCount: scan.invalidFiles.length,
    });
  }

  const currentIndex = await tryReadIndexRecords(openPlanRoot);
  if (currentIndex.kind === "missing") {
    if (scan.records.length === 0) {
      return {
        ok: true,
        indexPath: OPENPLAN_INDEX_FILE,
        scannedFileCount: 0,
        rebuiltRecordCount: 0,
        status: "empty",
        mode: "self-check",
      };
    }

    const rebuilt = await rebuildOpenPlanIndex({
      mode: "self-check-rebuild",
      ...(input.configDir ? { configDir: input.configDir } : {}),
      ...(input.testFaults ? { testFaults: input.testFaults } : {}),
    });
    return {
      ok: true,
      indexPath: rebuilt.indexPath,
      scannedFileCount: rebuilt.scannedFileCount,
      rebuiltRecordCount: rebuilt.rebuiltRecordCount,
      status: rebuilt.rebuiltRecordCount === 0 ? "empty" : "repaired",
      mode: "self-check-rebuild",
    };
  }

  if (currentIndex.kind === "invalid" || !recordsMatchCurrentState(currentIndex.records, scan.records)) {
    const rebuilt = await rebuildOpenPlanIndex({
      mode: "self-check-rebuild",
      ...(input.configDir ? { configDir: input.configDir } : {}),
      ...(input.testFaults ? { testFaults: input.testFaults } : {}),
    });
    return {
      ok: true,
      indexPath: rebuilt.indexPath,
      scannedFileCount: rebuilt.scannedFileCount,
      rebuiltRecordCount: rebuilt.rebuiltRecordCount,
      status: rebuilt.rebuiltRecordCount === 0 ? "empty" : "repaired",
      mode: "self-check-rebuild",
    };
  }

  return {
    ok: true,
    indexPath: OPENPLAN_INDEX_FILE,
    scannedFileCount: scan.scannedFileCount,
    rebuiltRecordCount: scan.records.length,
    status: scan.records.length === 0 ? "empty" : "healthy",
    mode: "self-check",
  };
}

async function safeReplacePlanFile(input: {
  targetPath: string;
  nextContent: string;
  fault: boolean;
}): Promise<void> {
  const tempPath = `${input.targetPath}.tmp`;
  const backupPath = `${input.targetPath}.bak`;

  await safeRemoveFile(tempPath);
  await safeRemoveFile(backupPath);

  try {
    await writeFile(tempPath, input.nextContent, { flag: "wx" });

    if (input.fault) {
      throw new Error("injected update replace failure");
    }

    await rename(input.targetPath, backupPath);

    try {
      await rename(tempPath, input.targetPath);
      await rm(backupPath, { force: true });
    } catch (error) {
      await safeRemoveFile(input.targetPath);
      await rename(backupPath, input.targetPath);
      throw error;
    }
  } catch (error) {
    await safeRemoveFile(tempPath);
    await safeRestoreBackup(backupPath, input.targetPath);
    throw new Error(`PLANART_ERR_PLAN_REPLACE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveExplicitUpdateTarget(
  openPlanRoot: string,
  targetPlanRef: string,
  sessionKey: string,
): Promise<CurrentStateIndexRecord> {
  if (!targetPlanRef.startsWith(`${sessionKey}/`)) {
    throw new Error("PLANART_ERR_CROSS_SESSION_UPDATE: targetPlanRef must stay under the current session.");
  }

  const absolutePath = path.join(openPlanRoot, ...targetPlanRef.split("/"));
  try {
    await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`PLANART_ERR_TARGET_NOT_FOUND: target plan does not exist: ${targetPlanRef}`);
    }
    throw error;
  }

  const records = await readExistingIndexRecords(openPlanRoot);
  return records.find((record) => record.path === targetPlanRef)
    ?? frontmatterToIndexRecord(parseFrontmatter(await readFile(absolutePath, "utf8")));
}

async function resolveCreateProvenance(
  openPlanRoot: string,
  sourcePlanRef: string,
  currentSessionKey: string,
  sourceSessionKeyInput?: string,
): Promise<{ source_session_key: string; source_plan_ref: string }> {
  const normalizedSourcePlanRef = assertOpenPlanRelativePlanRef(sourcePlanRef, "sourcePlanRef");
  const absolutePath = path.join(openPlanRoot, ...normalizedSourcePlanRef.split("/"));
  const sourceContent = await readExistingPlanArtifact(absolutePath, normalizedSourcePlanRef);
  const sourceFrontmatter = frontmatterToOpenPlanFrontmatter(parseFrontmatter(sourceContent));

  if (sourceFrontmatter.session_key === currentSessionKey) {
    throw new Error("PLANART_ERR_SOURCE_SAME_SESSION: sourcePlanRef must point to a plan from a different session.");
  }

  if (sourceSessionKeyInput && sourceSessionKeyInput.trim() !== sourceFrontmatter.session_key) {
    throw new Error("PLANART_ERR_SOURCE_SESSION_MISMATCH: sourceSessionKey does not match sourcePlanRef.");
  }

  return {
    source_session_key: sourceFrontmatter.session_key,
    source_plan_ref: normalizedSourcePlanRef,
  };
}

async function resolveReplacementTarget(
  openPlanRoot: string,
  replacesPlanRef: string,
  replacesSessionKeyInput?: string,
): Promise<{
  absolutePath: string;
  targetFrontmatter: OpenPlanFrontmatter;
  body: string;
}> {
  const normalizedReplacesPlanRef = assertOpenPlanRelativePlanRef(replacesPlanRef, "replacesPlanRef");
  const absolutePath = path.join(openPlanRoot, ...normalizedReplacesPlanRef.split("/"));
  const targetContent = await readExistingPlanArtifact(absolutePath, normalizedReplacesPlanRef);
  const targetDocument = splitPlanDocument(targetContent);
  const targetFrontmatter = frontmatterToOpenPlanFrontmatter(targetDocument.frontmatter);

  if (replacesSessionKeyInput && replacesSessionKeyInput.trim() !== targetFrontmatter.session_key) {
    throw new Error("PLANART_ERR_REPLACEMENT_TARGET_SESSION_MISMATCH: replacesSessionKey does not match replacesPlanRef.");
  }
  if (targetFrontmatter.status === "superseded") {
    throw new Error("PLANART_ERR_REPLACEMENT_TARGET_ALREADY_SUPERSEDED: replacement target already superseded.");
  }
  if (targetFrontmatter.status !== "draft" && targetFrontmatter.status !== "reviewed" && targetFrontmatter.status !== "blocked") {
    throw new Error("PLANART_ERR_REPLACEMENT_TARGET_STATUS_NOT_ELIGIBLE: replacement target status not eligible.");
  }

  return {
    absolutePath,
    targetFrontmatter,
    body: targetDocument.body,
  };
}

async function writeSupersededReplacementTarget(
  replacement: {
    absolutePath: string;
    targetFrontmatter: OpenPlanFrontmatter;
    body: string;
  },
  input: {
    testFaults?: WritePlanArtifactInput["testFaults"];
  } = {},
): Promise<CurrentStateIndexRecord> {
  const updatedTargetFrontmatter: OpenPlanFrontmatter = {
    ...replacement.targetFrontmatter,
    status: "superseded",
  };

  await safeReplacePlanFile({
    targetPath: replacement.absolutePath,
    nextContent: buildPlanDocument(updatedTargetFrontmatter, replacement.body),
    fault: input.testFaults?.failReplacementTargetWrite === true,
  });

  return frontmatterToIndexRecord(updatedTargetFrontmatter);
}

async function resolveDefaultUpdateTarget(
  openPlanRoot: string,
  sessionKey: string,
): Promise<CurrentStateIndexRecord> {
  const records = await readExistingIndexRecords(openPlanRoot);
  const candidates = records.filter((record) => record.session_key === sessionKey);
  if (candidates.length === 0) {
    throw new Error("PLANART_ERR_NO_SESSION_CANDIDATE: current session has no persisted plan to update; cannot default update.");
  }

  candidates.sort((left, right) => {
    if (left.updated_at !== right.updated_at) return right.updated_at.localeCompare(left.updated_at);
    return right.path.localeCompare(left.path);
  });

  const target = candidates[0];
  if (!target) {
    throw new Error("PLANART_ERR_NO_SESSION_CANDIDATE: current session has no persisted plan to update; cannot default update.");
  }

  return target;
}

function resolveUpdateStatus(input: {
  requestedStatus: PlanArtifactStatus | undefined;
  hasContentUpdate: boolean;
  currentStatus: PlanArtifactStatus;
}): Exclude<PlanArtifactStatus, "superseded"> {
  if (input.requestedStatus === "superseded") {
    throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: Phase 2 does not support status=superseded.");
  }
  if (input.requestedStatus === "reviewed" || input.requestedStatus === "blocked") {
    return input.requestedStatus;
  }
  if (input.requestedStatus === "draft") return "draft";
  if (input.hasContentUpdate) return "draft";
  return input.currentStatus === "reviewed" || input.currentStatus === "blocked"
    ? input.currentStatus
    : "draft";
}

async function readExistingPlanArtifact(absolutePath: string, relativePath: string): Promise<string> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`PLANART_ERR_TARGET_NOT_FOUND: target plan does not exist: ${relativePath}`);
    }
    throw error;
  }
}

function splitPlanDocument(markdown: string): PlanDocumentParts {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: markdown.trimEnd() };
  }

  const frontmatter: Record<string, string> = {};
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") {
      closingIndex = index;
      break;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match?.[1]) frontmatter[match[1]] = match[2]?.trim() ?? "";
  }

  const bodyLines = closingIndex === -1 ? [] : lines.slice(closingIndex + 1);
  if (bodyLines[0] === "") bodyLines.shift();

  return {
    frontmatter,
    body: bodyLines.join("\n").trimEnd(),
  };
}

export function resolveOpenPlanRoot(configDir?: string): string {
  return path.join(resolveOpenCodeConfigDir(configDir), OPENPLAN_DIR);
}

export function resolveOpenCodeConfigDir(configDir?: string): string {
  if (process.env.OPENCODE_CONFIG_DIR && process.env.OPENCODE_CONFIG_DIR.trim() !== "") {
    return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  }

  if (configDir && configDir.trim() !== "") {
    return path.resolve(configDir);
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "opencode");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
}

export function sanitizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "plan";
}

export function parseFrontmatter(markdown: string): Record<string, string> {
  return splitPlanDocument(markdown).frontmatter;
}

function assertSessionKey(value: string): string {
  const sessionKey = value.trim();
  if (!SESSION_KEY_PATTERN.test(sessionKey)) {
    throw new Error("PLANART_ERR_INVALID_SESSION_KEY: sessionKey is required and must match YYYYMMDD-HHmm-xxxxxxxx.");
  }
  return sessionKey;
}

function assertPlanId(value: string): string {
  const planId = value.trim();
  if (!PLAN_ID_PATTERN.test(planId)) {
    throw new Error("PLANART_ERR_INVALID_PLAN_ID: planId must be 8 lowercase alphanumeric characters.");
  }
  return planId;
}

function assertFilenameHint(value: string): string {
  const filename = value.trim();
  if (!filename) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint is required.");
  if (filename !== value) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must not include leading or trailing whitespace.");
  if (filename === "." || filename === "..") throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must be a plain filename.");
  if (/\s/.test(filename)) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must not contain whitespace.");
  if (filename.includes("/") || filename.includes("\\")) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must be a plain filename.");
  if (!filename.toLowerCase().endsWith(".md")) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must end with .md.");
  if (filename.endsWith(".")) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint must not end with a dot.");
  if (/[:*?"<>|]/.test(filename)) throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint contains invalid characters.");
  if (!/^[\p{L}\p{N}\-_.()]+$/u.test(filename)) {
    throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint contains unsupported characters.");
  }

  const baseName = path.parse(filename).name.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    throw new Error("PLANART_ERR_INVALID_FILENAME_HINT: filenameHint uses a Windows reserved name.");
  }

  return filename;
}

function assertTargetPlanRef(value: string, sessionKey: string): string {
  const normalized = normalizeRelativePath(value.replaceAll("\\", "/"));
  if (!normalized) {
    throw new Error("PLANART_ERR_INVALID_TARGET_PLAN_REF: targetPlanRef is required when provided.");
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error("PLANART_ERR_INVALID_TARGET_PLAN_REF: targetPlanRef must be relative to openplan/.");
  }
  if (normalized.includes("\0")) {
    throw new Error("PLANART_ERR_INVALID_TARGET_PLAN_REF: targetPlanRef contains an invalid character.");
  }
  if (path.posix.normalize(normalized) !== normalized || normalized.startsWith("../")) {
    throw new Error("PLANART_ERR_INVALID_TARGET_PLAN_REF: targetPlanRef must be normalized and cannot traverse directories.");
  }
  if (!normalized.endsWith(".md")) {
    throw new Error("PLANART_ERR_INVALID_TARGET_PLAN_REF: targetPlanRef must end with .md.");
  }
  if (!normalized.startsWith(`${sessionKey}/`)) {
    throw new Error("PLANART_ERR_CROSS_SESSION_UPDATE: targetPlanRef must stay under the current session.");
  }
  return normalized;
}

async function resolveCreateOnlyFilename(sessionDir: string, filenameHint: string): Promise<string> {
  const parsed = path.parse(filenameHint);
  const versionMatch = parsed.name.match(/^(.*?)-v(\d+)$/);
  const stem = versionMatch?.[1] && versionMatch[1].trim() !== "" ? versionMatch[1] : parsed.name;
  let version = versionMatch ? Number.parseInt(versionMatch[2] ?? "2", 10) : 1;

  while (true) {
    const candidateName = version <= 1
      ? `${stem}${parsed.ext}`
      : `${stem}-v${version}${parsed.ext}`;
    const candidatePath = path.join(sessionDir, candidateName);

    try {
      await readFile(candidatePath, "utf8");
      version += 1;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return candidateName;
      throw error;
    }
  }
}

function buildPlanDocument(frontmatter: OpenPlanFrontmatter, markdown: string): string {
  const lines = [
    "---",
    `plan_id: ${frontmatter.plan_id}`,
    `title: ${frontmatter.title}`,
    `session_key: ${frontmatter.session_key}`,
    `session_started_at: ${frontmatter.session_started_at}`,
    `created_at: ${frontmatter.created_at}`,
    `updated_at: ${frontmatter.updated_at}`,
    `operation: ${frontmatter.operation}`,
    `status: ${frontmatter.status}`,
    `generated_by: ${frontmatter.generated_by}`,
    `filename: ${frontmatter.filename}`,
    `path: ${frontmatter.path}`,
    ...(frontmatter.maturity_level ? [`maturity_level: ${frontmatter.maturity_level}`] : []),
    ...(frontmatter.source_session_key && frontmatter.source_plan_ref
      ? [
        `source_session_key: ${frontmatter.source_session_key}`,
        `source_plan_ref: ${frontmatter.source_plan_ref}`,
      ]
      : []),
    ...(frontmatter.replaces_session_key && frontmatter.replaces_plan_ref
      ? [
        `replaces_session_key: ${frontmatter.replaces_session_key}`,
        `replaces_plan_ref: ${frontmatter.replaces_plan_ref}`,
      ]
      : []),
    "---",
    "",
    markdown,
  ];

  return `${lines.join("\n")}\n`;
}

async function rewriteCurrentStateIndex(
  openPlanRoot: string,
  additionalRecords: CurrentStateIndexRecord[] = [],
  options: { replace?: boolean } = {},
): Promise<void> {
  const existingRecords = options.replace ? [] : await readExistingIndexRecords(openPlanRoot);
  const currentState = new Map<string, CurrentStateIndexRecord>();

  for (const record of existingRecords) {
    currentState.set(record.path, record);
  }

  for (const record of additionalRecords) {
    currentState.set(record.path, record);
  }

  const sortedRecords = [...currentState.values()].sort(compareCurrentStateRecords);
  const indexText = renderIndexText(sortedRecords);
  const indexPath = path.join(openPlanRoot, "index.jsonl");
  const tmpPath = `${indexPath}.tmp`;
  const bakPath = `${indexPath}.bak`;

  await mkdir(openPlanRoot, { recursive: true });
  await writeFile(tmpPath, indexText);

  let backupCreated = false;
  try {
    try {
      await rm(bakPath, { force: true });
      await rename(indexPath, bakPath);
      backupCreated = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }

    await rename(tmpPath, indexPath);
    if (backupCreated) await rm(bakPath, { force: true });
  } catch (error) {
    await safeRemoveFile(tmpPath);

    if (backupCreated) {
      try {
        await safeRemoveFile(indexPath);
        await rename(bakPath, indexPath);
      } catch {
        // Best-effort restore. Caller escalates after rebuild attempt if needed.
      }
    }

    throw new Error(`index write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readExistingIndexRecords(openPlanRoot: string): Promise<CurrentStateIndexRecord[]> {
  const result = await tryReadIndexRecords(openPlanRoot);
  if (result.kind === "missing") return [];
  if (result.kind === "invalid") {
    throw new Error(result.errorMessage);
  }
  return result.records;
}

async function tryReadIndexRecords(openPlanRoot: string): Promise<
  | { kind: "ok"; records: CurrentStateIndexRecord[] }
  | { kind: "missing" }
  | { kind: "invalid"; errorMessage: string }
> {
  const indexPath = path.join(openPlanRoot, "index.jsonl");

  try {
    const content = await readFile(indexPath, "utf8");
    return {
      kind: "ok",
      records: content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => normalizeIndexRecord(JSON.parse(line) as Record<string, unknown>)),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
    return {
      kind: "invalid",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function scanOpenPlanRecords(openPlanRoot: string): Promise<OpenPlanScanResult> {
  const records: CurrentStateIndexRecord[] = [];
  const invalidFiles: Array<{ path: string; errorMessage: string }> = [];
  let scannedFileCount = 0;

  try {
    ({ scannedFileCount } = await collectMarkdownRecords(openPlanRoot, openPlanRoot, records, invalidFiles));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { records: [], scannedFileCount: 0, invalidFiles: [] };
    }
    throw error;
  }

  records.sort(compareCurrentStateRecords);
  return { records, scannedFileCount, invalidFiles };
}

async function collectMarkdownRecords(
  rootDir: string,
  currentDir: string,
  records: CurrentStateIndexRecord[],
  invalidFiles: Array<{ path: string; errorMessage: string }>,
): Promise<{ scannedFileCount: number }> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  let scannedFileCount = 0;

  for (const entry of entries) {
    if (entry.name === "index.jsonl" || entry.name.endsWith(".tmp") || entry.name.endsWith(".bak")) continue;

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMarkdownRecords(rootDir, absolutePath, records, invalidFiles);
      scannedFileCount += nested.scannedFileCount;
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    scannedFileCount += 1;

    try {
      const content = await readFile(absolutePath, "utf8");
      records.push(frontmatterToIndexRecord(parseFrontmatter(content)));
    } catch (error) {
      invalidFiles.push({
        path: normalizeRelativePath(path.relative(rootDir, absolutePath)),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scannedFileCount };
}

function frontmatterToOpenPlanFrontmatter(frontmatter: Record<string, string>): OpenPlanFrontmatter {
  const record = frontmatterToIndexRecord(frontmatter);
  return {
    ...record,
  };
}

function frontmatterToIndexRecord(frontmatter: Record<string, string> | OpenPlanFrontmatter): CurrentStateIndexRecord {
  const requiredFields = [
    "plan_id",
    "title",
    "session_key",
    "session_started_at",
    "created_at",
    "updated_at",
    "operation",
    "status",
    "generated_by",
    "path",
    "filename",
  ] as const;

  for (const field of requiredFields) {
    if (!frontmatter[field] || frontmatter[field]?.trim() === "") {
      throw new Error(`missing frontmatter field: ${field}`);
    }
  }

  const operation = normalizeOperation(String(frontmatter.operation ?? ""));
  const status = normalizeStatus(String(frontmatter.status ?? ""));
  const hasSourceSessionKey = typeof frontmatter.source_session_key === "string" && frontmatter.source_session_key.trim() !== "";
  const hasSourcePlanRef = typeof frontmatter.source_plan_ref === "string" && frontmatter.source_plan_ref.trim() !== "";
  const hasReplacesSessionKey = typeof frontmatter.replaces_session_key === "string" && frontmatter.replaces_session_key.trim() !== "";
  const hasReplacesPlanRef = typeof frontmatter.replaces_plan_ref === "string" && frontmatter.replaces_plan_ref.trim() !== "";

  if (hasSourceSessionKey !== hasSourcePlanRef) {
    throw new Error("provenance fields must either both exist or both be absent");
  }
  if (hasReplacesSessionKey !== hasReplacesPlanRef) {
    throw new Error("replacement fields must either both exist or both be absent");
  }

  if (hasSourcePlanRef) {
    assertSessionKey(String(frontmatter.source_session_key));
    assertOpenPlanRelativePlanRef(String(frontmatter.source_plan_ref), "source_plan_ref");
  }
  if (hasReplacesPlanRef) {
    assertSessionKey(String(frontmatter.replaces_session_key));
    assertOpenPlanRelativePlanRef(String(frontmatter.replaces_plan_ref), "replaces_plan_ref");
  }

  return {
    plan_id: frontmatter.plan_id ?? "",
    title: frontmatter.title ?? "",
    session_key: frontmatter.session_key ?? "",
    session_started_at: frontmatter.session_started_at ?? "",
    created_at: frontmatter.created_at ?? "",
    updated_at: frontmatter.updated_at ?? "",
    operation,
    status,
    generated_by: frontmatter.generated_by ?? "",
    path: normalizeRelativePath(frontmatter.path ?? ""),
    filename: frontmatter.filename ?? "",
    ...(frontmatter.maturity_level ? { maturity_level: frontmatter.maturity_level } : {}),
    ...(hasSourceSessionKey && hasSourcePlanRef
      ? {
        source_session_key: String(frontmatter.source_session_key),
        source_plan_ref: normalizeRelativePath(String(frontmatter.source_plan_ref)),
      }
      : {}),
    ...(hasReplacesSessionKey && hasReplacesPlanRef
      ? {
        replaces_session_key: String(frontmatter.replaces_session_key),
        replaces_plan_ref: normalizeRelativePath(String(frontmatter.replaces_plan_ref)),
      }
      : {}),
  };
}

function normalizeIndexRecord(record: Record<string, unknown>): CurrentStateIndexRecord {
  return frontmatterToIndexRecord(stringifyRecord(record));
}

function renderIndexText(records: CurrentStateIndexRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

function compareCurrentStateRecords(left: CurrentStateIndexRecord, right: CurrentStateIndexRecord): number {
  if (left.updated_at !== right.updated_at) return left.updated_at.localeCompare(right.updated_at);
  return left.path.localeCompare(right.path);
}

function recordsMatchCurrentState(left: CurrentStateIndexRecord[], right: CurrentStateIndexRecord[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = renderIndexText([...left].sort(compareCurrentStateRecords));
  const normalizedRight = renderIndexText([...right].sort(compareCurrentStateRecords));
  return normalizedLeft === normalizedRight;
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

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function normalizeStatus(value: string): PlanArtifactStatus {
  if (value === "draft" || value === "reviewed" || value === "blocked" || value === "superseded") {
    return value;
  }
  throw new Error(`unsupported status: ${value}`);
}

function assertOpenPlanRelativePlanRef(value: string, fieldName: string): string {
  const normalized = normalizeRelativePath(value.replaceAll("\\", "/"));
  if (!normalized) {
    throw new Error(`PLANART_ERR_INVALID_${fieldName.toUpperCase()}: ${fieldName} is required when provided.`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`PLANART_ERR_INVALID_${fieldName.toUpperCase()}: ${fieldName} must be relative to openplan/.`);
  }
  if (normalized.includes("\0")) {
    throw new Error(`PLANART_ERR_INVALID_${fieldName.toUpperCase()}: ${fieldName} contains an invalid character.`);
  }
  if (path.posix.normalize(normalized) !== normalized || normalized.startsWith("../")) {
    throw new Error(`PLANART_ERR_INVALID_${fieldName.toUpperCase()}: ${fieldName} must be normalized and cannot traverse directories.`);
  }
  if (!normalized.endsWith(".md")) {
    throw new Error(`PLANART_ERR_INVALID_${fieldName.toUpperCase()}: ${fieldName} must end with .md.`);
  }
  return normalized;
}

function normalizeOperation(value: string): PlanArtifactOperation {
  if (value === "create" || value === "update") {
    return value;
  }
  throw new Error(`unsupported operation: ${value}`);
}

function toUtcIsoString(value: string, fieldName: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`PLANART_ERR_INVALID_TIMESTAMP: ${fieldName} must be a valid ISO 8601 timestamp.`);
  }
  return date.toISOString();
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
}

async function safeRemoveFile(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

async function cleanupFailedPlanWrite(filePath: string, error: unknown): Promise<void> {
  if (isNodeError(error) && error.code === "EEXIST") return;
  await safeRemoveFile(filePath);
}

async function safeRestoreBackup(backupPath: string, targetPath: string): Promise<void> {
  try {
    await readFile(backupPath, "utf8");
    await safeRemoveFile(targetPath);
    await rename(backupPath, targetPath);
  } catch {
    // Best-effort restore only.
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
