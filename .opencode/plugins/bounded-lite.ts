import { MAX_CHILD_ORCHESTRATOR_DEPTH, ROLE_CONTRACTS, type RoutingCategory } from "../lib/contracts.js";
import { BackgroundCoordinator } from "../lib/runtime/background.js";
import {
  type PluginHooks,
  type PluginInput,
} from "../lib/runtime/plugin-types.js";
import { resolveCategoryRoute } from "../lib/runtime/categories.js";
import { buildTaskDAG, type TaskDispatchConfig } from "../lib/runtime/plan-dag.js";
import { validatePlanReadiness } from "../lib/runtime/plan-readiness.js";
import {
  ensureOpenPlanIndexHealthyOnce,
  parseFrontmatter,
  rebuildOpenPlanIndex,
  resolveOpenPlanRoot,
  writePlanArtifact,
} from "../lib/runtime/plan-artifact.js";
import { createRuntimeProfile } from "../lib/runtime/safety.js";
import {
  applyRoleModelConfig,
  applyRoleReasoningEffortConfig,
  applyTaskLeadProfileModelConfig,
  buildDiscoveredModelPool,
  formatAutoModelReport,
  formatModelImportReport,
  formatModelConfigReport,
  formatTaskLeadProfileModelReport,
  importModelPool,
  inferModelPoolPolicy,
  listKnownModelsForCredentialProviders,
  listProviderModels,
  listProviderModelsFromModelsDevResponse,
  listProviderModelsFromResponse,
  mergeProviderModels,
  type ModelFamily,
  type ModelPoolPolicy,
  type ModelProviderSource,
  resolveAutoModels,
  resolveAutoReasoningEffortAssignments,
  resolveAutoTaskLeadProfileModels,
  summarizeRoleModels,
  summarizeTaskLeadProfileModels,
} from "../lib/runtime/model-config.js";
import {
  applyLiteRoleModelConfig,
  applyLiteRoleReasoningEffortConfig,
  applyLiteTaskLeadProfileModelConfig,
  applyLiteTaskLeadProfileReasoningEffortConfig,
  createDefaultLiteConfig,
  defaultRoleReasoningEffort,
  LITE_CONFIG_FILE,
  migrateLiteConfigFromOpenCodeConfig,
  readLiteConfig,
  resolveSupportedReasoningEffort,
  type LiteOpenAgentConfig,
  withLiteConfigAppliedToOpenCodeConfig,
} from "../lib/runtime/lite-config.js";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isKnownTaskLeadProfile } from "../lib/runtime/task-lead-profiles.js";
import { tool } from "@opencode-ai/plugin/tool";
import { inflateRawSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PLUGIN_FILE = "bounded-lite.ts";
const STUDY_SUPPORTED_EXTENSIONS = new Set([".ppt", ".pptx", ".pdf"]);
const STUDY_GENERATED_FILES = new Set([
  "AGENTS.md",
  "source-index.json",
  "study-guide.md",
  "exam-points.md",
  "mindmap.md",
  "anki_flashcards.csv",
  "practice-questions.md",
  "coverage-report.md",
]);
const STUDY_GENERATED_DIRECTORIES = new Set([
  "sources",
  "summaries",
  "reviews",
  "repairs",
  ".opencode",
  ".liteagent",
]);
const STUDY_AGENT_START = "<!-- oh-my-lite-study:start -->";
const STUDY_AGENT_END = "<!-- oh-my-lite-study:end -->";
const execFileAsync = promisify(execFile);

type StudyExtractionQuality = "high" | "medium" | "low" | "blocked";

interface StudySlide {
  page: number;
  title?: string;
  text: string;
  lowText: boolean;
  extractionMethod?: string;
  extractionQuality?: StudyExtractionQuality;
  confidence?: number;
  needsManualReview?: boolean;
}

interface StudyExtractionSummary {
  method: string;
  quality: StudyExtractionQuality;
  confidence: number;
  textLength: number;
  lowTextPageCount: number;
  needsManualReview: boolean;
}

export interface BoundedLitePluginOptions {
  mode?: "full" | "degraded";
  enableHooks?: boolean;
  enableBackground?: boolean;
  enableBundledMcp?: boolean;
  maxChildDepth?: number;
  configDir?: string;
  taskLeadProfiles?: Record<string, unknown>;
  planArtifactTestFaults?: {
    failRebuild?: boolean;
  };
  planArtifactTestHooks?: {
    onSelfCheckAttempt?: () => void;
  };
}

export interface NormalizedBoundedLitePluginOptions {
  mode: "full" | "degraded";
  enableHooks: boolean;
  enableBackground: boolean;
  enableBundledMcp: boolean;
  maxChildDepth: number;
  configDir?: string;
  taskLeadProfiles?: Record<string, unknown>;
  planArtifactTestFaults?: {
    failRebuild?: boolean;
  };
  planArtifactTestHooks?: {
    onSelfCheckAttempt?: () => void;
  };
}

export function normalizePluginOptions(
  options: BoundedLitePluginOptions = {},
): NormalizedBoundedLitePluginOptions {
  const mode = options.mode ?? "full";

  return {
    mode,
    enableHooks: options.enableHooks ?? true,
    enableBackground: options.enableBackground ?? mode === "full",
    enableBundledMcp: options.enableBundledMcp ?? false,
    maxChildDepth: options.maxChildDepth ?? MAX_CHILD_ORCHESTRATOR_DEPTH,
    ...(typeof options.configDir === "string" && options.configDir.trim() !== ""
      ? { configDir: options.configDir }
      : {}),
    ...(typeof options.taskLeadProfiles === "object" &&
        options.taskLeadProfiles !== null &&
        !Array.isArray(options.taskLeadProfiles)
      ? { taskLeadProfiles: normalizeTaskLeadProfilesConfig(options.taskLeadProfiles) }
      : {}),
    ...(typeof options.planArtifactTestFaults === "object" &&
        options.planArtifactTestFaults !== null &&
        !Array.isArray(options.planArtifactTestFaults)
      ? {
        planArtifactTestFaults: {
          ...(options.planArtifactTestFaults.failRebuild === true ? { failRebuild: true } : {}),
        },
      }
      : {}),
    ...(typeof options.planArtifactTestHooks === "object" &&
        options.planArtifactTestHooks !== null &&
        !Array.isArray(options.planArtifactTestHooks)
      ? {
        planArtifactTestHooks: {
          ...(typeof options.planArtifactTestHooks.onSelfCheckAttempt === "function"
            ? { onSelfCheckAttempt: options.planArtifactTestHooks.onSelfCheckAttempt }
            : {}),
        },
      }
      : {}),
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

function defaultConfigDir(configDir?: string): string {
  if (process.env.OPENCODE_CONFIG_DIR) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  if (configDir) return path.resolve(configDir);

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "opencode");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "opencode");
}

function defaultDataDir(): string {
  if (process.env.OPENCODE_DATA_DIR) return path.resolve(process.env.OPENCODE_DATA_DIR);

  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "opencode");
  }

  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "opencode");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProjectRoot(input: PluginInput): string {
  return path.resolve(input.project?.root ?? input.worktree ?? input.directory ?? process.cwd());
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function stripJsonComments(content: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        output += content[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(content: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(content[lookahead] ?? "")) lookahead += 1;
      if (content[lookahead] === "}" || content[lookahead] === "]") continue;
    }

    output += char;
  }

  return output;
}

function parseJsonConfig(content: string): Record<string, unknown> {
  return JSON.parse(stripTrailingCommas(stripJsonComments(content.replace(/^\uFEFF/, "")))) as Record<string, unknown>;
}

function slugifyStudyId(value: string): string {
  const slug = value
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || "courseware";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChapterCandidates(text: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /(?:^|[\n\r。；;])\s*((?:第\s*[一二三四五六七八九十百千万0-9]+\s*[章节讲部分篇][^\n\r。；;]{0,48}))/g,
    /(?:^|[\n\r])\s*((?:chapter|unit|module|lecture|section)\s+[0-9ivxlcdm]+[^\n\r]{0,48})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) candidates.push(match[1]);
    }
  }

  return uniqueStrings(candidates).slice(0, 20);
}

function buildStudyManagedAgentsBlock(sourceCount: number): string {
  return [
    STUDY_AGENT_START,
    "## Oh My Lite Study Project",
    "",
    "- Treat courseware files as the canonical source for this directory.",
    "- Mark all supplemental non-courseware material as `[External]`.",
    "- Keep `sources/` source-faithful and `summaries/` exam-focused.",
    "- Update `coverage-report.md` when adding or repairing review materials.",
    `- Current indexed courseware files: ${sourceCount}.`,
    STUDY_AGENT_END,
  ].join("\n");
}

function upsertStudyAgentsBlock(content: string, sourceCount: number): { content?: string; blocker?: Record<string, unknown> } {
  const starts = [...content.matchAll(new RegExp(STUDY_AGENT_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  const ends = [...content.matchAll(new RegExp(STUDY_AGENT_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];

  if (starts.length === 0 && ends.length === 0) {
    const separator = content.trim() === "" ? "" : "\n\n";
    return { content: `${content.replace(/\s*$/, "")}${separator}${buildStudyManagedAgentsBlock(sourceCount)}\n` };
  }

  if (starts.length !== 1 || ends.length !== 1 || starts[0]?.index === undefined || ends[0]?.index === undefined || starts[0].index > ends[0].index) {
    return {
      blocker: {
        file: "AGENTS.md",
        reason: "Invalid oh-my-lite-study managed markers: expected exactly one ordered start/end pair.",
        recoverability: "recoverable",
      },
    };
  }

  const before = content.slice(0, starts[0].index).replace(/\s*$/, "");
  const after = content.slice(ends[0].index + STUDY_AGENT_END.length).replace(/^\s*/, "");
  return {
    content: `${before}${before ? "\n\n" : ""}${buildStudyManagedAgentsBlock(sourceCount)}${after ? `\n\n${after}` : ""}`,
  };
}

function sourceId(source: Record<string, unknown>): string {
  return typeof source.id === "string" ? source.id : slugifyStudyId(String(source.filename ?? "courseware"));
}

function sourceTitle(source: Record<string, unknown>): string {
  return typeof source.filename === "string" ? source.filename : sourceId(source);
}

function sourceSlides(source: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(source.slides) ? source.slides.filter(isRecord) : [];
}

function buildSourceMarkdown(source: Record<string, unknown>): string {
  const slides = sourceSlides(source);
  const lines = [`# ${sourceTitle(source)}`, "", "Source-faithful extracted courseware notes.", ""];

  for (const slide of slides) {
    lines.push(`## Page ${slide.page ?? "?"}`);
    if (typeof slide.title === "string" && slide.title.trim() !== "") lines.push(`Title: ${slide.title}`);
    lines.push("", typeof slide.text === "string" && slide.text.trim() !== "" ? slide.text.trim() : "[Low text / manual text review needed]", "");
  }

  if (slides.length === 0) lines.push("[No extractable text. Manual text review or conversion review needed.]", "");
  return `${lines.join("\n").trim()}\n`;
}

function buildSummaryMarkdown(source: Record<string, unknown>): string {
  const chapters = Array.isArray(source.chapterCandidates) ? source.chapterCandidates : [];
  const lowTextPages = Array.isArray(source.lowTextPages) ? source.lowTextPages : [];

  return [
    `# ${sourceTitle(source)} Summary`,
    "",
    "## Chapter Candidates",
    ...(chapters.length > 0 ? chapters.map((chapter) => `- ${chapter}`) : ["- To be refined from source notes."]),
    "",
    "## Exam Focus",
    "- Key points should be derived from the source-faithful notes in the matching `sources/` file.",
    "- Mark any supplemental explanation as `[External]`.",
    "",
    "## Manual Text Review",
    ...(lowTextPages.length > 0 ? lowTextPages.map((page) => `- Page ${page}: low-text or text-sparse.`) : ["- No low-text pages reported by ingest."]),
    "",
  ].join("\n");
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    throw error;
  }
}

function readStudyPackageStage(args: Record<string, unknown>): "sources" | "full" {
  const stage = readString(args["stage"]);
  return stage === "sources" || stage === "source-index" ? "sources" : "full";
}

async function generateStudyPackage(directory: string, stage: "sources" | "full" = "full"): Promise<Record<string, unknown>> {
  const coursewareDir = path.resolve(directory);
  const sourceIndex = await ingestStudyCourseware(coursewareDir);
  const sources = Array.isArray(sourceIndex.sources) ? sourceIndex.sources.filter(isRecord) : [];
  const agentsPath = path.join(coursewareDir, "AGENTS.md");
  const agentsResult = upsertStudyAgentsBlock(await readOptionalFile(agentsPath), sources.length);

  if (agentsResult.blocker) {
    return {
      status: "blocked",
      recoverableBlockers: [agentsResult.blocker],
      writtenFiles: [],
    };
  }

  for (const directoryName of ["sources", "summaries", "reviews", "repairs"]) {
    await mkdir(path.join(coursewareDir, directoryName), { recursive: true });
  }

  const writtenFiles: string[] = [];
  const writeStudyFile = async (relativePath: string, content: string): Promise<void> => {
    await writeFile(path.join(coursewareDir, relativePath), content);
    writtenFiles.push(relativePath);
  };

  await writeStudyFile("AGENTS.md", agentsResult.content ?? buildStudyManagedAgentsBlock(sources.length));
  await writeStudyFile("source-index.json", `${JSON.stringify(sourceIndex, null, 2)}\n`);
  await writeStudyFile("coverage-report.md", `# Coverage Report\n\n- Indexed courseware files: ${sources.length}\n- Low-text pages: ${Array.isArray(sourceIndex.lowTextPages) ? sourceIndex.lowTextPages.length : 0}\n- Recoverable blockers: ${Array.isArray(sourceIndex.recoverableBlockers) ? sourceIndex.recoverableBlockers.length : 0}\n`);

  for (const source of sources) {
    await writeStudyFile(`sources/${sourceId(source)}.md`, buildSourceMarkdown(source));
    if (stage === "full") await writeStudyFile(`summaries/${sourceId(source)}.md`, buildSummaryMarkdown(source));
  }

  if (stage === "full") {
    await writeStudyFile("study-guide.md", "# Study Guide\n\nUse `exam-points.md`, `practice-questions.md`, and per-deck summaries for final review.\n");
    await writeStudyFile("exam-points.md", `# Exam Points\n\n${sources.map((source) => `- ${sourceTitle(source)}: derive exam points from \`summaries/${sourceId(source)}.md\`.`).join("\n") || "- No courseware sources indexed."}\n`);
    await writeStudyFile("mindmap.md", `# Mindmap\n\n- Final Review\n${sources.map((source) => `  - ${sourceTitle(source)}`).join("\n")}\n`);
    await writeStudyFile("anki_flashcards.csv", "Front,Back,Source\n");
    await writeStudyFile("practice-questions.md", "# Practice Questions\n\n- Add source-referenced questions after summarization.\n");
  }

  return {
    status: "ok",
    stage,
    directory: coursewareDir,
    writtenFiles,
    sourceCount: sources.length,
    recoverableBlockers: sourceIndex.recoverableBlockers,
  };
}

function resolveStudyDirectory(args: Record<string, unknown>, context: PluginInput): string {
  const baseDirectory = path.resolve(context.directory ?? process.cwd());
  const requestedDirectory = readString(args["directory"]);
  if (!requestedDirectory) return baseDirectory;

  const directory = path.resolve(baseDirectory, requestedDirectory);
  const relative = path.relative(baseDirectory, directory);
  const insideBase = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!insideBase && args["allowExternalDirectory"] !== true) {
    throw new Error("Study tools require allowExternalDirectory=true before reading or writing outside the current OpenCode working directory.");
  }

  return directory;
}

function extractPdfLiteralText(content: string): string {
  const chunks: string[] = [];

  for (const match of content.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    chunks.push(match[0].replace(/\)\s*Tj$/, "").replace(/^\(/, ""));
  }

  for (const match of content.matchAll(/\[((?:\s*\((?:\\.|[^\\)]).*?\)\s*)+)\]\s*TJ/g)) {
    const arrayContent = match[1] ?? "";
    chunks.push(...[...arrayContent.matchAll(/\((?:\\.|[^\\)])*\)/g)].map((item) => item[0].slice(1, -1)));
  }

  return chunks
    .join(" ")
    .replace(/\\([nrtbf()\\])/g, (_match, escaped: string) => {
      if (escaped === "n" || escaped === "r") return "\n";
      if (escaped === "t") return "\t";
      return escaped;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeStudyExtraction(
  method: string,
  slides: readonly StudySlide[],
  blocked = false,
): StudyExtractionSummary {
  const textLength = slides.reduce((sum, slide) => sum + slide.text.trim().length, 0);
  const lowTextPageCount = slides.filter((slide) => slide.lowText).length;
  const lowTextRatio = slides.length > 0 ? lowTextPageCount / slides.length : 1;
  const quality: StudyExtractionQuality = blocked
    ? "blocked"
    : textLength === 0 || lowTextRatio > 0.6
      ? "low"
      : method.includes("fallback") || lowTextRatio > 0.25
        ? "medium"
        : "high";
  const confidence = quality === "high" ? 0.9 : quality === "medium" ? 0.65 : quality === "low" ? 0.35 : 0;

  return {
    method,
    quality,
    confidence,
    textLength,
    lowTextPageCount,
    needsManualReview: blocked || quality === "low" || lowTextPageCount > 0,
  };
}

function extractZipEntries(buffer: Buffer): Array<{ name: string; text: string }> {
  const entries: Array<{ name: string; text: string }> = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) break;

    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    const raw = buffer.subarray(dataStart, dataEnd);
    let data: Buffer | undefined;

    if (compression === 0) data = raw;
    if (compression === 8) {
      try {
        data = inflateRawSync(raw);
      } catch {
        data = undefined;
      }
    }

    if (data && /(?:ppt\/slides\/slide\d+|ppt\/notesSlides\/notesSlide\d+|docProps\/)/.test(name)) {
      entries.push({ name, text: data.toString("utf8") });
    }

    offset = dataEnd;
  }

  return entries;
}

function extractPptxSlides(buffer: Buffer): StudySlide[] {
  const entries = extractZipEntries(buffer)
    .filter((entry) => /ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

  if (entries.length === 0) {
    const fallback = decodeXmlText(buffer.toString("utf8"));
    const title = fallback.split(/[。.!?\n]/, 1)[0]?.slice(0, 80);
    return fallback
      ? [{
        page: 1,
        ...(title ? { title } : {}),
        text: fallback,
        lowText: fallback.length < 40,
        extractionMethod: "pptx-xml-fallback",
        extractionQuality: fallback.length < 40 ? "low" : "medium",
        confidence: fallback.length < 40 ? 0.35 : 0.65,
        needsManualReview: fallback.length < 40,
      }]
      : [];
  }

  return entries.map((entry, index) => {
    const textRuns = [...entry.text.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1] ?? ""));
    const text = uniqueStrings(textRuns).join("\n");

    return {
      page: index + 1,
      ...(textRuns[0] ? { title: textRuns[0].slice(0, 120) } : {}),
      text,
      lowText: text.length < 40,
      extractionMethod: "pptx-xml",
      extractionQuality: text.length < 40 ? "low" : "high",
      confidence: text.length < 40 ? 0.35 : 0.9,
      needsManualReview: text.length < 40,
    };
  });
}

function extractPdfPagesFromText(text: string, method: string, pageHint = 1): StudySlide[] {
  const pages = text.split(/\f|(?:\s*-{3,}\s*)/).filter((page) => page.trim() !== "");
  const normalized = pages.length > 0 ? pages : [text];

  return normalized.slice(0, pageHint || normalized.length).map((pageText, index) => {
    const cleanText = pageText.trim();
    const title = cleanText.split(/[。.!?\n]/, 1)[0]?.slice(0, 120);
    const lowText = cleanText.length < 80;

    return {
      page: index + 1,
      ...(title ? { title } : {}),
      text: cleanText,
      lowText,
      extractionMethod: method,
      extractionQuality: lowText ? "low" : method.includes("fallback") ? "medium" : "high",
      confidence: lowText ? 0.35 : method.includes("fallback") ? 0.65 : 0.9,
      needsManualReview: lowText,
    };
  });
}

function extractPdfPages(buffer: Buffer): StudySlide[] {
  const content = buffer.toString("latin1");
  const pageCount = Math.max(1, (content.match(/\/Type\s*\/Page\b/g) ?? []).length);
  const text = extractPdfLiteralText(content) || decodeXmlText(content.replace(/[^\x20-\x7e\u4e00-\u9fff]+/g, " "));
  return extractPdfPagesFromText(text, "pdf-literal-fallback", pageCount);
}

async function extractPdfPagesWithOptionalTool(filePath: string, buffer: Buffer): Promise<StudySlide[]> {
  const pdftotext = await findExecutableOnPath(process.platform === "win32" ? ["pdftotext.exe", "pdftotext"] : ["pdftotext"]);
  if (pdftotext) {
    try {
      const { stdout } = await execFileAsync(pdftotext, ["-layout", filePath, "-"], {
        timeout: 10_000,
        maxBuffer: 20 * 1024 * 1024,
      });
      const text = String(stdout).trim();
      if (text !== "") return extractPdfPagesFromText(text, "pdftotext", Math.max(1, text.split("\f").length));
    } catch {
    }
  }

  return extractPdfPages(buffer);
}

async function findExecutableOnPath(names: readonly string[]): Promise<string | undefined> {
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
      }
    }
  }

  return undefined;
}

async function findConvertedCoursewareFile(directory: string, baseName: string): Promise<string | undefined> {
  for (const extension of [".pptx", ".pdf"]) {
    const candidate = path.join(directory, `${baseName}${extension}`);
    if (await fileExists(candidate)) return candidate;
  }

  return undefined;
}

async function convertLegacyPptWithSoffice(
  filePath: string,
  soffice: string,
): Promise<{ convertedPath?: string; outputDirectory: string; error?: string }> {
  const conversionDirectory = path.join(os.tmpdir(), `omo-lite-ppt-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  try {
    await mkdir(conversionDirectory, { recursive: true });
    await execFileAsync(soffice, [
      "--headless",
      "--convert-to",
      "pptx",
      "--outdir",
      conversionDirectory,
      filePath,
    ], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const convertedPath = await findConvertedCoursewareFile(conversionDirectory, path.basename(filePath, path.extname(filePath)));
    return {
      outputDirectory: conversionDirectory,
      ...(convertedPath ? { convertedPath } : {}),
    };
  } catch (error) {
    return {
      outputDirectory: conversionDirectory,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function extractSlidesFromCoursewareFile(filePath: string, extension: string): Promise<StudySlide[]> {
  const buffer = await readFile(filePath);
  if (extension === ".pptx") return extractPptxSlides(buffer);
  if (extension === ".pdf") return extractPdfPagesWithOptionalTool(filePath, buffer);
  return [];
}

async function ingestStudyCourseware(
  directory: string,
): Promise<Record<string, unknown>> {
  const coursewareDir = path.resolve(directory);
  const entries = await readdir(coursewareDir, { withFileTypes: true });
  const sources: Array<Record<string, unknown>> = [];
  const ignoredGeneratedOutputs: string[] = [];
  const recoverableBlockers: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (STUDY_GENERATED_DIRECTORIES.has(entry.name)) ignoredGeneratedOutputs.push(`${entry.name}/`);
      continue;
    }

    if (!entry.isFile()) continue;
    if (STUDY_GENERATED_FILES.has(entry.name)) {
      ignoredGeneratedOutputs.push(entry.name);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!STUDY_SUPPORTED_EXTENSIONS.has(extension)) continue;

    const filePath = path.join(coursewareDir, entry.name);
    const info = await stat(filePath);
    const source: Record<string, unknown> = {
      id: slugifyStudyId(entry.name),
      filename: entry.name,
      extension,
      sizeBytes: info.size,
      status: "ok",
      slides: [],
      chapterCandidates: [],
      lowTextPages: [],
      warnings: [],
      blockers: [],
    };

    let slides: StudySlide[] = [];
    if (extension === ".ppt") {
      const soffice = await findExecutableOnPath(process.platform === "win32" ? ["soffice.exe", "soffice"] : ["soffice", "libreoffice"]);
      if (!soffice) {
        const blocker = {
          file: entry.name,
          reason: "Legacy .ppt requires LibreOffice/soffice conversion before text extraction.",
          recoverability: "recoverable",
          requiredTool: "soffice",
        };
        source.status = "blocked";
        source.extraction = summarizeStudyExtraction("ppt-soffice-missing", [], true);
        source.blockers = [blocker];
        recoverableBlockers.push(blocker);
        sources.push(source);
        continue;
      }

      const conversion = await convertLegacyPptWithSoffice(filePath, soffice);
      source.converter = soffice;
      source.conversion = {
        method: "soffice",
        outputDirectory: conversion.outputDirectory,
        ...(conversion.convertedPath ? { convertedPath: conversion.convertedPath } : {}),
        ...(conversion.error ? { error: conversion.error } : {}),
      };

      if (!conversion.convertedPath) {
        const blocker = {
          file: entry.name,
          reason: conversion.error ?? "LibreOffice/soffice did not produce a converted .pptx or .pdf file.",
          recoverability: "recoverable",
          requiredTool: "soffice",
        };
        source.status = "blocked";
        source.extraction = summarizeStudyExtraction("ppt-soffice-conversion-failed", [], true);
        source.blockers = [blocker];
        recoverableBlockers.push(blocker);
        sources.push(source);
        continue;
      }

      const convertedExtension = path.extname(conversion.convertedPath).toLowerCase();
      slides = (await extractSlidesFromCoursewareFile(conversion.convertedPath, convertedExtension)).map((slide) => ({
        ...slide,
        extractionMethod: `soffice->${slide.extractionMethod ?? convertedExtension.slice(1)}`,
      }));
    } else {
      slides = await extractSlidesFromCoursewareFile(filePath, extension);
    }

    const allText = slides.map((slide) => slide.text).join("\n");
    const chapterCandidates = extractChapterCandidates(allText);
    const lowTextPages = slides.filter((slide) => slide.lowText).map((slide) => slide.page);

    source.slides = slides;
    source.pageCount = slides.length;
    source.chapterCandidates = chapterCandidates;
    source.lowTextPages = lowTextPages;
    source.extraction = summarizeStudyExtraction(extension === ".ppt" ? "ppt-soffice-converted" : (slides[0]?.extractionMethod ?? "unknown"), slides);
    source.status = slides.length > 0 && allText.trim() !== "" ? "ok" : "low-text";
    source.warnings = lowTextPages.length > 0
      ? [`${lowTextPages.length} page(s) are low-text or text-sparse and need manual review.`]
      : [];
    sources.push(source);
  }

  const chapterCandidates = uniqueStrings(
    sources.flatMap((source) => Array.isArray(source.chapterCandidates) ? source.chapterCandidates as string[] : []),
  );
  const lowTextPages = sources.flatMap((source) => (
    Array.isArray(source.lowTextPages)
      ? (source.lowTextPages as number[]).map((page) => ({ file: source.filename, page }))
      : []
  ));

  return {
    directory: coursewareDir,
    policy: {
      recursive: false,
      canonicalSource: "courseware",
      externalLabelRequired: "[External]",
      outputDirectory: "current-directory",
    },
    discoveredFiles: sources.map((source) => source.filename),
    ignoredGeneratedOutputs,
    sources,
    chapterCandidates,
    lowTextPages,
    recoverableBlockers,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveOpenCodeConfigPath(configDir?: string): Promise<string> {
  const directory = defaultConfigDir(configDir);
  const jsonPath = path.join(directory, "opencode.json");
  const jsoncPath = path.join(directory, "opencode.jsonc");

  if (await fileExists(jsonPath)) return jsonPath;
  if (await fileExists(jsoncPath)) return jsoncPath;
  return jsonPath;
}

function isBoundedLitePluginSpec(spec: unknown): boolean {
  const value = Array.isArray(spec) ? spec[0] : spec;
  return typeof value === "string" && value.includes(PLUGIN_FILE);
}

function readBoundedLitePluginOptions(config: Record<string, unknown>): Record<string, unknown> {
  const rawPlugins = Array.isArray(config["plugin"])
    ? config["plugin"]
    : config["plugin"]
      ? [config["plugin"]]
      : [];

  for (const spec of rawPlugins) {
    if (!isBoundedLitePluginSpec(spec)) continue;
    if (Array.isArray(spec) && isRecord(spec[1])) return spec[1];
  }

  return {};
}

function configuredTaskLeadProfiles(
  config: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Record<string, unknown> {
  const pluginOptions = readBoundedLitePluginOptions(config);
  if (isRecord(pluginOptions["taskLeadProfiles"])) return normalizeTaskLeadProfilesConfig(pluginOptions["taskLeadProfiles"]);
  if (isRecord(options.taskLeadProfiles)) return normalizeTaskLeadProfilesConfig(options.taskLeadProfiles);
  return isRecord(config["taskLeadProfiles"]) ? normalizeTaskLeadProfilesConfig(config["taskLeadProfiles"]) : {};
}

function withConfiguredTaskLeadProfiles(
  config: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Record<string, unknown> {
  return {
    ...config,
    taskLeadProfiles: configuredTaskLeadProfiles(config, options),
  };
}

function updateBoundedLitePluginOptions(
  config: Record<string, unknown>,
  updater: (pluginOptions: Record<string, unknown>) => Record<string, unknown>,
): void {
  const rawPlugins = Array.isArray(config["plugin"])
    ? config["plugin"]
    : config["plugin"]
      ? [config["plugin"]]
      : [];
  let updated = false;

  const plugins = rawPlugins.map((spec) => {
    if (!isBoundedLitePluginSpec(spec)) return spec;

    if (Array.isArray(spec)) {
      const next = [...spec];
      const existingOptions = isRecord(spec[1]) ? spec[1] : {};
      next[1] = updater(existingOptions);
      updated = true;
      return next;
    }

    updated = true;
    return [spec, updater({})];
  });

  if (updated) config["plugin"] = plugins;
}

function writeTaskLeadProfilesToPluginOptions(
  config: Record<string, unknown>,
  taskLeadProfiles: Record<string, unknown>,
): void {
  updateBoundedLitePluginOptions(config, (pluginOptions) => ({
    ...pluginOptions,
    taskLeadProfiles: normalizeTaskLeadProfilesConfig(taskLeadProfiles),
  }));
  delete config["taskLeadProfiles"];
}

function normalizeTaskLeadProfilesConfig(
  taskLeadProfiles: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [profileName, rawProfile] of Object.entries(taskLeadProfiles)) {
    if (!isKnownTaskLeadProfile(profileName)) continue;

    if (typeof rawProfile === "string" && rawProfile.trim() !== "") {
      normalized[profileName] = { model: rawProfile.trim() };
      continue;
    }

    if (!isRecord(rawProfile)) continue;

    const model = readString(rawProfile["model"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    const attributes = readStringArray(rawProfile["attributes"]);

    normalized[profileName] = {
      ...(model ? { model } : {}),
      ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
      ...(attributes.length > 0 ? { attributes } : {}),
    };
  }

  return normalized;
}

function taskLeadProfilesToDispatch(
  taskLeadProfiles: Record<string, unknown>,
): Partial<TaskDispatchConfig> {
  const profileModelMap: Record<string, string> = {};
  const profileFallbackModelMap: Record<string, string[]> = {};
  const attributeProfileMap: Record<string, string> = {};

  for (const [profileName, rawProfile] of Object.entries(taskLeadProfiles)) {
    if (!isRecord(rawProfile)) continue;

    const model = readString(rawProfile["model"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    const attributes = readStringArray(rawProfile["attributes"]);

    if (model) profileModelMap[profileName] = model;
    if (fallbackModels.length > 0) profileFallbackModelMap[profileName] = fallbackModels;

    for (const attribute of attributes) {
      attributeProfileMap[attribute] = profileName;
    }
  }

  return {
    ...(Object.keys(profileModelMap).length > 0 ? { profileModelMap } : {}),
    ...(Object.keys(profileFallbackModelMap).length > 0 ? { profileFallbackModelMap } : {}),
    ...(Object.keys(attributeProfileMap).length > 0 ? { attributeProfileMap } : {}),
  };
}

function mergeTaskDispatchWithConfiguredProfiles(
  dispatch: Record<string, unknown>,
  options: NormalizedBoundedLitePluginOptions,
): Partial<TaskDispatchConfig> {
  const profileDispatch = taskLeadProfilesToDispatch(options.taskLeadProfiles ?? {});
  const inputDispatch = dispatch as Partial<TaskDispatchConfig>;

  return {
    ...profileDispatch,
    ...inputDispatch,
    profileModelMap: {
      ...(profileDispatch.profileModelMap ?? {}),
      ...(isRecord(inputDispatch.profileModelMap) ? inputDispatch.profileModelMap : {}),
    },
    profileFallbackModelMap: {
      ...(profileDispatch.profileFallbackModelMap ?? {}),
      ...(isRecord(inputDispatch.profileFallbackModelMap) ? inputDispatch.profileFallbackModelMap : {}),
    },
    attributeProfileMap: {
      ...(profileDispatch.attributeProfileMap ?? {}),
      ...(isRecord(inputDispatch.attributeProfileMap) ? inputDispatch.attributeProfileMap : {}),
    },
  };
}

async function readOpenCodeConfig(configDir?: string): Promise<Record<string, unknown>> {
  const configPath = await resolveOpenCodeConfigPath(configDir);
  const content = await readFile(configPath, "utf8");
  return parseJsonConfig(content);
}

async function readOpenCodeAuthProviderIds(): Promise<string[]> {
  try {
    const content = await readFile(path.join(defaultDataDir(), "auth.json"), "utf8");
    const auth = JSON.parse(content) as unknown;
    return isRecord(auth) ? Object.keys(auth) : [];
  } catch {
    return [];
  }
}

async function writeOpenCodeConfig(config: Record<string, unknown>, configDir?: string): Promise<string> {
  const configPath = await resolveOpenCodeConfigPath(configDir);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(`${configPath}.bak`, `${JSON.stringify(await readOpenCodeConfig(configDir), null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function resolveLiteConfigPath(configDir?: string): string {
  return path.join(defaultConfigDir(configDir), LITE_CONFIG_FILE);
}

async function readLiteConfigFile(configDir?: string, opencodeConfig?: Record<string, unknown>): Promise<LiteOpenAgentConfig> {
  try {
    const content = await readFile(resolveLiteConfigPath(configDir), "utf8");
    return migrateLiteConfigFromOpenCodeConfig(opencodeConfig ?? {}, readLiteConfig(parseJsonConfig(content)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    return migrateLiteConfigFromOpenCodeConfig(opencodeConfig ?? {}, createDefaultLiteConfig());
  }
}

async function writeLiteConfigFile(liteConfig: LiteOpenAgentConfig, configDir?: string): Promise<string> {
  const liteConfigPath = resolveLiteConfigPath(configDir);
  await mkdir(path.dirname(liteConfigPath), { recursive: true });
  try {
    await writeFile(`${liteConfigPath}.bak`, await readFile(liteConfigPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    await writeFile(`${liteConfigPath}.bak`, `${JSON.stringify(createDefaultLiteConfig(), null, 2)}\n`);
  }
  await writeFile(liteConfigPath, `${JSON.stringify(liteConfig, null, 2)}\n`);
  return liteConfigPath;
}

async function updateGeneratedAgentMarkdownFiles(
  liteConfig: LiteOpenAgentConfig,
  configDir?: string,
): Promise<string[]> {
  const directory = defaultConfigDir(configDir);
  const agentsDir = path.join(directory, "agents");
  await mkdir(agentsDir, { recursive: true });
  const updated: string[] = [];

  for (const role of ROLE_CONTRACTS) {
    const filePath = path.join(agentsDir, `${role.name}.md`);
    let content = `---\nmode: ${role.opencodeMode}\ndescription: ${JSON.stringify(role.name)}\n---\n\n# ${role.name}\n`;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    const model = liteConfig.roleModels[role.name];
    const nextContent = upsertMarkdownFrontmatter(content, {
      ...(model ? { model } : {}),
      reasoningEffort: undefined,
    });
    await writeFile(`${filePath}.bak`, content);
    await writeFile(filePath, nextContent);
    updated.push(filePath);
  }

  return updated;
}

function upsertMarkdownFrontmatter(content: string, updates: Record<string, string | undefined>): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = match ? content.slice(match[0].length) : content;
  const frontmatter = match?.[1] ?? "";
  const lines = frontmatter.split("\n").filter((line) => {
    const key = line.split(":", 1)[0]?.trim();
    return key !== "model" && key !== "reasoningEffort";
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

function yamlScalar(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : JSON.stringify(value);
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

async function listModelsDevProviderModels(providerIds: readonly string[]): Promise<ReturnType<typeof listProviderModels>> {
  if (providerIds.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch("https://models.dev/api.json", { signal: controller.signal });
    if (!response.ok) return [];

    return listProviderModelsFromModelsDevResponse(await response.json(), providerIds);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function readModelPoolPolicy(args: unknown): ModelPoolPolicy {
  const request = isRecord(args) ? args : {};
  const policy = isRecord(request["policy"]) ? request["policy"] : {};
  const sourceValue = typeof policy["source"] === "string"
    ? policy["source"]
    : typeof request["source"] === "string"
      ? request["source"]
      : undefined;
  const source = isModelSourceFilter(sourceValue) ? sourceValue : undefined;
  const providerPreference = readStringArray(policy["providerPreference"] ?? request["providerPreference"]);
  const familyPreference = readFamilyArray(policy["familyPreference"] ?? request["familyPreference"]);
  const allowCodexBackend = typeof policy["allowCodexBackend"] === "boolean"
    ? policy["allowCodexBackend"]
    : typeof request["allowCodexBackend"] === "boolean"
      ? request["allowCodexBackend"]
      : undefined;

  return {
    ...(source ? { source } : {}),
    ...(providerPreference.length > 0 ? { providerPreference } : {}),
    ...(familyPreference.length > 0 ? { familyPreference } : {}),
    ...(typeof allowCodexBackend === "boolean" ? { allowCodexBackend } : {}),
  };
}

function readFamilyArray(value: unknown): ModelFamily[] {
  const valid = new Set<ModelFamily>(["gpt", "claude", "gemini", "kimi", "minimax", "glm", "codex", "other"]);
  return readStringArray(value).filter((item): item is ModelFamily => valid.has(item as ModelFamily));
}

function readRoleModelAssignments(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};

  for (const [role, assignment] of Object.entries(value)) {
    if (typeof assignment === "string") {
      result[role] = assignment;
      continue;
    }

    if (isRecord(assignment) && typeof assignment["model"] === "string") {
      result[role] = assignment["model"];
    }
  }

  return result;
}

function readEmbeddedReasoningEffortAssignments(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};

  for (const [role, assignment] of Object.entries(value)) {
    if (isRecord(assignment) && typeof assignment["reasoningEffort"] === "string") {
      result[role] = assignment["reasoningEffort"];
    }
  }

  return result;
}

function mergeRecordAssignments(...items: unknown[]): Record<string, unknown> {
  return items.reduce<Record<string, unknown>>((merged, item) => {
    if (!isRecord(item)) return merged;
    return { ...merged, ...item };
  }, {});
}

function isModelSourceFilter(value: unknown): value is ModelProviderSource | "all" {
  return (
    value === "opencode-subscription" ||
    value === "api-provider" ||
    value === "gateway" ||
    value === "unknown" ||
    value === "all"
  );
}

type ModelConfigAction = "import" | "list" | "auto" | "apply";

interface ModelConfigRequest {
  action: ModelConfigAction;
  assignments?: Record<string, unknown>;
  reasoningEffortAssignments?: Record<string, unknown>;
  taskLeadProfileAssignments?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  source?: string;
  providerPreference?: string[];
  familyPreference?: string[];
  allowCodexBackend?: boolean;
  allowUnavailableModels?: boolean;
}

interface ModelConfigValidationError {
  field: string;
  code: string;
  message: string;
}

interface ModelConfigResponse {
  ok: boolean;
  action: ModelConfigAction;
  applied: boolean;
  changed_keys: string[];
  validation_errors?: ModelConfigValidationError[];
  warnings?: string[];
  available_models?: Array<{ id: string; provider?: string; label?: string }>;
  role_assignments?: Record<string, string>;
  profile_assignments?: Record<string, string>;
  reasoning_effort_assignments?: Record<string, "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
  recommendations?: {
    roles?: Record<string, string>;
    taskLeadProfiles?: Record<string, string>;
    reasoningEffort?: Record<string, "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
  };
  report?: string;
}

type PlanArtifactRequest =
  | {
    action: "write";
    operation: "create" | "update";
    title?: string;
    markdown?: string;
    filenameHint?: string;
    generatedBy: string;
    status?: "draft" | "reviewed" | "blocked";
    maturityLevel?: string;
    targetPlanRef?: string;
    sourceSessionKey?: string;
    sourcePlanRef?: string;
    replacesSessionKey?: string;
    replacesPlanRef?: string;
  }
  | {
    action: "rebuild";
    generatedBy?: string;
    reason?: string;
  };

interface RuntimePlanArtifactSession {
  sessionKey: string;
  sessionStartedAt: string;
}

interface PersistedPlanArtifactSession extends RuntimePlanArtifactSession {
  path: string;
  updatedAt: string;
}

function createRuntimePlanArtifactSession(now: Date = new Date()): RuntimePlanArtifactSession {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);

  return {
    sessionKey: `${year}${month}${day}-${hour}${minute}-${suffix}`,
    sessionStartedAt: now.toISOString(),
  };
}

function normalizePlanArtifactPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

async function readPersistedPlanArtifactSessionFromTarget(
  openPlanRoot: string,
  targetPlanRef: string,
): Promise<RuntimePlanArtifactSession> {
  const absolutePath = path.join(openPlanRoot, ...targetPlanRef.split("/"));
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(`PLANART_ERR_TARGET_NOT_FOUND: target plan does not exist: ${targetPlanRef}`);
    }
    throw error;
  }
  const frontmatter = parseFrontmatter(content);
  const sessionKey = typeof frontmatter.session_key === "string" ? frontmatter.session_key.trim() : "";
  const sessionStartedAt = typeof frontmatter.session_started_at === "string" ? frontmatter.session_started_at.trim() : "";
  if (!sessionKey || !sessionStartedAt) {
    throw new Error("PLANART_ERR_INVALID_SESSION_CONTEXT: target plan is missing session metadata.");
  }
  return { sessionKey, sessionStartedAt };
}

async function readPersistedPlanArtifactSessions(openPlanRoot: string): Promise<PersistedPlanArtifactSession[]> {
  const indexPath = path.join(openPlanRoot, "index.jsonl");
  let content: string;

  try {
    content = await readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error("PLANART_ERR_NO_SESSION_CANDIDATE: current session has no persisted plan to update; cannot default update.");
    }
    throw error;
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((record) => ({
      path: typeof record.path === "string" ? record.path : "",
      sessionKey: typeof record.session_key === "string" ? record.session_key : "",
      sessionStartedAt: typeof record.session_started_at === "string" ? record.session_started_at : "",
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : "",
    }))
    .filter((record): record is PersistedPlanArtifactSession => (
      record.path !== "" && record.sessionKey !== "" && record.sessionStartedAt !== "" && record.updatedAt !== ""
    ));
}

async function resolveUpdatePlanArtifactSession(
  request: Extract<PlanArtifactRequest, { action: "write" }>,
  configDir?: string,
): Promise<RuntimePlanArtifactSession> {
  const openPlanRoot = resolveOpenPlanRoot(configDir);

  if (request.targetPlanRef) {
    const targetPlanRef = normalizePlanArtifactPath(request.targetPlanRef);
    return readPersistedPlanArtifactSessionFromTarget(openPlanRoot, targetPlanRef);
  }

  if (request.operation === "update") {
    const records = (await readPersistedPlanArtifactSessions(openPlanRoot))
      .sort((left, right) => {
        if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
        return right.path.localeCompare(left.path);
      });

    const latest = records[0];
    if (!latest) {
      throw new Error("PLANART_ERR_NO_SESSION_CANDIDATE: current session has no persisted plan to update; cannot default update.");
    }

    return { sessionKey: latest.sessionKey, sessionStartedAt: latest.sessionStartedAt };
  }

  const records = await readPersistedPlanArtifactSessions(openPlanRoot);

  if (records.length === 0) {
    throw new Error("PLANART_ERR_NO_SESSION_CANDIDATE: current session has no persisted plan to update; cannot default update.");
  }

  records.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);
    return right.path.localeCompare(left.path);
  });

  return {
    sessionKey: records[0]?.sessionKey ?? "",
    sessionStartedAt: records[0]?.sessionStartedAt ?? "",
  };
}

function toToolOutput(value: unknown): { output: string; metadata: Record<string, unknown> } {
  return {
    output: typeof value === "string" ? value : JSON.stringify(value),
    metadata: {},
  };
}

function formatToolJsonOutput(value: unknown): string {
  return JSON.stringify(value);
}

function inferModelConfigAction(payload: unknown): ModelConfigAction {
  if (!isRecord(payload)) return "list";
  const action = payload["action"];
  if (action === "import" || action === "list" || action === "auto" || action === "apply") {
    return action;
  }
  return "list";
}

function toAvailableModels(models: ReturnType<typeof importModelPool>): Array<{ id: string; provider?: string; label?: string }> {
  return models.map((model) => ({
    id: model.id,
    ...(model.provider ? { provider: model.provider } : {}),
    ...(model.name ? { label: model.name } : {}),
  }));
}

function collectChangedKeys(input: {
  roleChanged: Array<{ role: string }>;
  profileChanged: Array<{ profile: string }>;
  reasoningChanged: Array<{ role: string }>;
}): string[] {
  return [
    ...input.roleChanged.map((item) => `assignments.${item.role}`),
    ...input.profileChanged.map((item) => `taskLeadProfileAssignments.${item.profile}`),
    ...input.reasoningChanged.map((item) => `reasoningEffortAssignments.${item.role}`),
  ];
}

function parseModelConfigError(error: unknown, action: ModelConfigAction): ModelConfigResponse {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^(MODELCFG_ERR_[A-Z_]+):\s*(.*)$/);
  if (!match) {
    return {
      ok: false,
      action,
      applied: false,
      changed_keys: [],
      validation_errors: [{
        field: "runtime",
        code: "MODELCFG_ERR_RUNTIME",
        message,
      }],
    };
  }

  const code = match[1] ?? "MODELCFG_ERR_INVALID_PAYLOAD";
  const details = match[2] ?? message;
  const field = code === "MODELCFG_ERR_MISSING_ACTION" || code === "MODELCFG_ERR_UNKNOWN_ACTION"
    ? "action"
    : code === "MODELCFG_ERR_UNKNOWN_FIELD"
      ? "payload"
      : "request";

  return {
    ok: false,
    action,
    applied: false,
    changed_keys: [],
    validation_errors: [{ field, code, message: details }],
  };
}

function parsePlanArtifactError(error: unknown, action: "write" | "rebuild" = "write"): {
  ok: false;
  action: "write" | "rebuild";
  applied: false;
  code: string;
  message: string;
  expected?: { action: Array<"write" | "rebuild"> };
} {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^(PLANART_ERR_[A-Z_]+):\s*(.*)$/);
  const code = match?.[1] ?? "PLANART_ERR_RUNTIME";
  const details = match?.[2] ?? message;

  return {
    ok: false,
    action,
    applied: false,
    code,
    message: details,
    ...(
      code === "PLANART_ERR_MISSING_ACTION" || code === "PLANART_ERR_UNKNOWN_ACTION"
        ? { expected: { action: ["write", "rebuild"] as Array<"write" | "rebuild"> } }
        : {}
    ),
  };
}

function parsePlanArtifactRequest(payload: unknown): PlanArtifactRequest {
  if (!isRecord(payload)) {
    throw new Error("PLANART_ERR_INVALID_PAYLOAD: bounded_lite_plan_artifact payload must be an object.");
  }

  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);

  if (
    hasOwn("sessionKey") ||
    hasOwn("session_key") ||
    hasOwn("sessionStartedAt") ||
    hasOwn("session_started_at") ||
    hasOwn("planId") ||
    hasOwn("plan_id")
  ) {
    throw new Error(
      "PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN: sessionKey/sessionStartedAt/planId are system-owned and must not be provided.",
    );
  }

  const allowedFields = new Set([
    "action",
    "operation",
    "reason",
    "title",
    "markdown",
    "content",
    "filenameHint",
    "filename_hint",
    "generatedBy",
    "generated_by",
    "sourceSessionKey",
    "source_session_key",
    "sourcePlanRef",
    "source_plan_ref",
    "replacesSessionKey",
    "replaces_session_key",
    "replacesPlanRef",
    "replaces_plan_ref",
    "status",
    "maturityLevel",
    "maturity_level",
    "targetPlanRef",
    "target_plan_ref",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new Error(`PLANART_ERR_UNKNOWN_FIELD: unknown field "${key}".`);
    }
  }

  const action = readString(payload["action"]);
  if (!action) {
    throw new Error("PLANART_ERR_MISSING_ACTION: bounded_lite_plan_artifact requires action.");
  }
  if (action !== "write" && action !== "rebuild") {
    throw new Error("PLANART_ERR_UNKNOWN_ACTION: action must be write or rebuild.");
  }

  if (action === "rebuild") {
    const hasAny = (...keys: string[]): boolean => keys.some((key) => hasOwn(key));
    const rebuildGeneratedBy = readString(payload["generatedBy"]) ?? readString(payload["generated_by"]);
    const rebuildReason = readString(payload["reason"]);

    if (hasAny("targetPlanRef", "target_plan_ref")) {
      throw new Error("PLANART_ERR_REBUILD_TARGET_FORBIDDEN: rebuild does not accept targetPlanRef.");
    }
    if (hasAny("title", "markdown", "content")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept title or markdown fields.");
    }
    if (hasAny("sessionKey", "session_key")) {
      throw new Error("PLANART_ERR_REBUILD_SESSION_FORBIDDEN: rebuild does not accept sessionKey.");
    }
    if (hasAny("sessionStartedAt", "session_started_at")) {
      throw new Error("PLANART_ERR_REBUILD_SESSION_FORBIDDEN: rebuild does not accept sessionStartedAt.");
    }
    if (hasAny("filenameHint", "filename_hint")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept filenameHint.");
    }
    if (hasAny("planId", "plan_id")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept planId.");
    }
    if (hasAny("status")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept status.");
    }
    if (hasAny("maturityLevel", "maturity_level")) {
      throw new Error("PLANART_ERR_REBUILD_WRITE_FIELDS_FORBIDDEN: rebuild does not accept maturityLevel.");
    }

    return {
      action: "rebuild",
      ...(rebuildGeneratedBy ? { generatedBy: rebuildGeneratedBy } : {}),
      ...(rebuildReason ? { reason: rebuildReason } : {}),
    };
  }

  const title = readString(payload["title"]);
  const markdown = readString(payload["markdown"]) ?? readString(payload["content"]);
  const operation = readString(payload["operation"]) ?? "create";
  const filenameHint = readString(payload["filenameHint"]) ?? readString(payload["filename_hint"]);
  const generatedBy = readString(payload["generatedBy"]) ?? readString(payload["generated_by"]);
  const sourceSessionKey = readString(payload["sourceSessionKey"]) ?? readString(payload["source_session_key"]);
  const sourcePlanRef = readString(payload["sourcePlanRef"]) ?? readString(payload["source_plan_ref"]);
  const replacesSessionKey = readString(payload["replacesSessionKey"]) ?? readString(payload["replaces_session_key"]);
  const replacesPlanRef = readString(payload["replacesPlanRef"]) ?? readString(payload["replaces_plan_ref"]);
  const maturityLevel = readString(payload["maturityLevel"]) ?? readString(payload["maturity_level"]);
  const targetPlanRef = readString(payload["targetPlanRef"]) ?? readString(payload["target_plan_ref"]);

  if (operation !== "create" && operation !== "update") {
    throw new Error("PLANART_ERR_UNSUPPORTED_OPERATION: operation must be create or update.");
  }

  if (!generatedBy) throw new Error("PLANART_ERR_MISSING_GENERATED_BY: generatedBy is required.");

  const status = readString(payload["status"]);
  if (status && status !== "draft" && status !== "reviewed" && status !== "blocked") {
    throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: supported statuses are draft, reviewed, and blocked.");
  }

  if (operation === "create") {
    if (!title) throw new Error("PLANART_ERR_MISSING_TITLE: title is required.");
    if (!markdown) throw new Error("PLANART_ERR_MISSING_MARKDOWN: markdown is required.");
    if (!filenameHint) throw new Error("PLANART_ERR_MISSING_FILENAME_HINT: filenameHint is required.");
    if (sourceSessionKey && !sourcePlanRef) {
      throw new Error("PLANART_ERR_SOURCE_PLAN_REF_REQUIRED: sourceSessionKey requires sourcePlanRef.");
    }
    if (replacesSessionKey && !replacesPlanRef) {
      throw new Error("PLANART_ERR_REPLACEMENT_TARGET_MISSING: replacesSessionKey requires replacesPlanRef.");
    }
    if (status && status !== "draft" && status !== "reviewed" && status !== "blocked") {
      throw new Error("PLANART_ERR_UNSUPPORTED_STATUS: create supports draft, reviewed, or blocked.");
    }
  }

  if (operation === "update") {
    if (sourceSessionKey || sourcePlanRef) {
      throw new Error("PLANART_ERR_UPDATE_SOURCE_FORBIDDEN: update does not accept sourcePlanRef or sourceSessionKey.");
    }
    if (replacesSessionKey || replacesPlanRef) {
      throw new Error("PLANART_ERR_UPDATE_REPLACEMENT_FORBIDDEN: update does not accept replacesPlanRef or replacesSessionKey.");
    }
    if (!markdown && !status) {
      throw new Error("PLANART_ERR_MISSING_UPDATE_PAYLOAD: update requires markdown/content or status.");
    }
  }

  return {
    action: "write",
    operation,
    generatedBy,
    ...(title ? { title } : {}),
    ...(markdown ? { markdown } : {}),
    ...(filenameHint ? { filenameHint } : {}),
    ...(sourceSessionKey ? { sourceSessionKey } : {}),
    ...(sourcePlanRef ? { sourcePlanRef } : {}),
    ...(replacesSessionKey ? { replacesSessionKey } : {}),
    ...(replacesPlanRef ? { replacesPlanRef } : {}),
    ...(status === "draft" || status === "reviewed" || status === "blocked" ? { status } : {}),
    ...(maturityLevel ? { maturityLevel } : {}),
    ...(targetPlanRef ? { targetPlanRef } : {}),
  };
}

function parseModelConfigRequest(payload: unknown): ModelConfigRequest {
  if (!isRecord(payload)) {
    throw new Error("MODELCFG_ERR_INVALID_PAYLOAD: bounded_lite_model_config payload must be an object.");
  }

  const allowedFields = new Set([
    "action",
    "assignments",
    "reasoningEffortAssignments",
    "taskLeadProfileAssignments",
    "policy",
    "source",
    "providerPreference",
    "familyPreference",
    "allowCodexBackend",
    "allowUnavailableModels",
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedFields.has(key)) {
      throw new Error(`MODELCFG_ERR_UNKNOWN_FIELD: unknown field \"${key}\".`);
    }
  }

  if (typeof payload["action"] !== "string" || payload["action"].trim() === "") {
    throw new Error("MODELCFG_ERR_MISSING_ACTION: bounded_lite_model_config requires action.");
  }

  const action = payload["action"];
  if (action !== "import" && action !== "list" && action !== "auto" && action !== "apply") {
    throw new Error("MODELCFG_ERR_UNKNOWN_ACTION: action must be import, list, auto, or apply.");
  }

  return {
    action,
    ...(isRecord(payload["assignments"]) ? { assignments: payload["assignments"] } : {}),
    ...(isRecord(payload["reasoningEffortAssignments"])
      ? { reasoningEffortAssignments: payload["reasoningEffortAssignments"] }
      : {}),
    ...(isRecord(payload["taskLeadProfileAssignments"])
      ? { taskLeadProfileAssignments: payload["taskLeadProfileAssignments"] }
      : {}),
    ...(isRecord(payload["policy"]) ? { policy: payload["policy"] } : {}),
    ...(typeof payload["source"] === "string" ? { source: payload["source"] } : {}),
    ...(Array.isArray(payload["providerPreference"])
      ? { providerPreference: readStringArray(payload["providerPreference"]) }
      : {}),
    ...(Array.isArray(payload["familyPreference"])
      ? { familyPreference: readStringArray(payload["familyPreference"]) }
      : {}),
    ...(typeof payload["allowCodexBackend"] === "boolean"
      ? { allowCodexBackend: payload["allowCodexBackend"] }
      : {}),
    ...(typeof payload["allowUnavailableModels"] === "boolean"
      ? { allowUnavailableModels: payload["allowUnavailableModels"] }
      : {}),
  };
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
  let planArtifactSelfCheckHealthy = false;
  let planArtifactSelfCheckFailure: { code: string; message: string } | undefined;
  let planArtifactSelfCheckWarnings: {
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined;
  let planArtifactSelfCheckPromise: Promise<{
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined> | undefined;
  let runtimePlanArtifactSession: RuntimePlanArtifactSession | undefined;

  function extractPlanArtifactWarnings(value: Record<string, unknown>): {
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined {
    const warnings = Array.isArray(value["warnings"])
      ? value["warnings"].filter((item): item is { code: string; message: string; path?: string } => (
        isRecord(item) && typeof item["code"] === "string" && typeof item["message"] === "string"
      )).map((item) => ({
        code: item.code,
        message: item.message,
        ...(typeof item.path === "string" ? { path: item.path } : {}),
      }))
      : [];
    const skippedInvalidFileCount = typeof value["skippedInvalidFileCount"] === "number"
      ? value["skippedInvalidFileCount"]
      : undefined;
    const firstSkippedInvalidFile = typeof value["firstSkippedInvalidFile"] === "string"
      ? value["firstSkippedInvalidFile"]
      : undefined;

    if (warnings.length === 0 && skippedInvalidFileCount === undefined && firstSkippedInvalidFile === undefined) {
      return undefined;
    }

    return {
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(typeof skippedInvalidFileCount === "number" ? { skippedInvalidFileCount } : {}),
      ...(firstSkippedInvalidFile ? { firstSkippedInvalidFile } : {}),
    };
  }

  function mergePlanArtifactWarnings(...items: Array<{
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined>): {
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined {
    const warningList: Array<{ code: string; message: string; path?: string }> = [];
    let skippedInvalidFileCount = 0;
    let firstSkippedInvalidFile: string | undefined;

    for (const item of items) {
      if (!item) continue;
      if (Array.isArray(item.warnings)) warningList.push(...item.warnings);
      if (typeof item.skippedInvalidFileCount === "number") skippedInvalidFileCount += item.skippedInvalidFileCount;
      if (!firstSkippedInvalidFile && item.firstSkippedInvalidFile) firstSkippedInvalidFile = item.firstSkippedInvalidFile;
    }

    if (warningList.length === 0 && skippedInvalidFileCount === 0 && !firstSkippedInvalidFile) {
      return undefined;
    }

    return {
      ...(warningList.length > 0 ? { warnings: warningList } : {}),
      ...(skippedInvalidFileCount > 0 ? { skippedInvalidFileCount } : {}),
      ...(firstSkippedInvalidFile ? { firstSkippedInvalidFile } : {}),
    };
  }

  async function ensurePlanArtifactSelfCheck(): Promise<{
    warnings?: Array<{ code: string; message: string; path?: string }>;
    skippedInvalidFileCount?: number;
    firstSkippedInvalidFile?: string;
  } | undefined> {
    if (planArtifactSelfCheckHealthy) return planArtifactSelfCheckWarnings;

    if (!planArtifactSelfCheckPromise) {
      planArtifactSelfCheckPromise = (async () => {
        try {
          options.planArtifactTestHooks?.onSelfCheckAttempt?.();
          const result = await ensureOpenPlanIndexHealthyOnce({
            ...(options.configDir ? { configDir: options.configDir } : {}),
            ...(options.planArtifactTestFaults ? { testFaults: options.planArtifactTestFaults } : {}),
          });
          const warnings = extractPlanArtifactWarnings(result as unknown as Record<string, unknown>);
          planArtifactSelfCheckWarnings = warnings;
          planArtifactSelfCheckFailure = undefined;
          planArtifactSelfCheckHealthy = true;
          return warnings;
        } catch (error) {
          const parsed = parsePlanArtifactError(error);
          planArtifactSelfCheckFailure = {
            code: parsed.code,
            message: `index self-check repair failed: ${parsed.message}; requires follow-up repair`,
          };
          planArtifactSelfCheckWarnings = undefined;
          planArtifactSelfCheckHealthy = false;
          throw error;
        } finally {
          planArtifactSelfCheckPromise = undefined;
        }
      })();
    }

    return planArtifactSelfCheckPromise;
  }

  return {
    async config() {
      if (options.maxChildDepth > MAX_CHILD_ORCHESTRATOR_DEPTH) {
        throw new Error(
          `maxChildDepth must stay <= ${MAX_CHILD_ORCHESTRATOR_DEPTH} to preserve bounded orchestration.`,
        );
      }
    },
    tool: {
      bounded_lite_route: {
        description: "Resolve a bounded internal routing category to its target role.",
        args: {},
        async execute(args) {
          const category = args["category"];

          if (!isRoutingCategory(category)) {
            throw new Error("Route tool requires a valid bounded routing category.");
          }

          return formatToolJsonOutput(resolveCategoryRoute(category));
        },
      },
      bounded_lite_plan_dag: {
        description: "Validate a required plan.subtasks payload and return bounded DAG waves plus dispatch profiles.",
        args: {},
        async execute(args) {
          const payload = args["payload"];
          const dispatch = mergeTaskDispatchWithConfiguredProfiles(
            isRecord(args["dispatch"]) ? args["dispatch"] : {},
            options,
          );

          return formatToolJsonOutput(buildTaskDAG(payload, dispatch as Partial<TaskDispatchConfig>));
        },
      },
      bounded_lite_plan_readiness: {
        description: "Validate a Plan Builder artifact against readiness gates before Command Lead dispatches execution.",
        args: {},
        async execute(args) {
          const payload = args["payload"];
          const dispatch = mergeTaskDispatchWithConfiguredProfiles(
            isRecord(args["dispatch"]) ? args["dispatch"] : {},
            options,
          );

          return formatToolJsonOutput(validatePlanReadiness(payload, dispatch as Partial<TaskDispatchConfig>));
        },
      },
      bounded_lite_plan_artifact: {
        description: `Persist a Command Lead-approved openplan artifact with create/update semantics, or rebuild openplan/index.jsonl from plan frontmatter.

System-owned metadata:
- create always injects sessionKey/sessionStartedAt from the runtime session
- default create planId is system-generated
- model-supplied sessionKey/sessionStartedAt/planId are rejected; Command Lead only provides semantic content
- update restores session metadata from the persisted target or current-state index

Examples:
- create: { "action": "write", "operation": "create", "title": "My Plan", "filenameHint": "my-plan.md", "markdown": "# My Plan", "generatedBy": "command-lead" }
- update: { "action": "write", "operation": "update", "targetPlanRef": "20260518-1030-a1b2c3d4/my-plan.md", "markdown": "# Updated", "generatedBy": "command-lead" }
- rebuild: { "action": "rebuild", "reason": "manual repair" }`,
        args: {
          action: tool.schema.enum(["write", "rebuild"]),
          operation: tool.schema.enum(["create", "update"]).optional(),
          reason: tool.schema.string().optional(),
          title: tool.schema.string().optional(),
          markdown: tool.schema.string().optional(),
          content: tool.schema.string().optional(),
          filenameHint: tool.schema.string().optional(),
          filename_hint: tool.schema.string().optional(),
          generatedBy: tool.schema.string().optional(),
          generated_by: tool.schema.string().optional(),
          sourceSessionKey: tool.schema.string().optional(),
          source_session_key: tool.schema.string().optional(),
          sourcePlanRef: tool.schema.string().optional(),
          source_plan_ref: tool.schema.string().optional(),
          replacesSessionKey: tool.schema.string().optional(),
          replaces_session_key: tool.schema.string().optional(),
          replacesPlanRef: tool.schema.string().optional(),
          replaces_plan_ref: tool.schema.string().optional(),
          status: tool.schema.enum(["draft", "reviewed", "blocked"]).optional(),
          maturityLevel: tool.schema.string().optional(),
          maturity_level: tool.schema.string().optional(),
          targetPlanRef: tool.schema.string().optional(),
          target_plan_ref: tool.schema.string().optional(),
        },
        async execute(args, context) {
          const requestedAction = readString(args["action"]) === "rebuild" ? "rebuild" : "write";

          try {
            const request = parsePlanArtifactRequest(args);
            let selfCheckWarnings: {
              warnings?: Array<{ code: string; message: string; path?: string }>;
              skippedInvalidFileCount?: number;
              firstSkippedInvalidFile?: string;
            } | undefined;
            if (request.action !== "rebuild") {
              try {
                selfCheckWarnings = await ensurePlanArtifactSelfCheck();
              } catch {
                // failure state is exposed below via planArtifactSelfCheckFailure
              }
            }
            if (request.action === "write") {
              if (request.operation !== "update") {
                runtimePlanArtifactSession ??= createRuntimePlanArtifactSession();
              }
            }
            if (request.action === "rebuild") {
              const rebuilt = await rebuildOpenPlanIndex({
                ...(options.configDir ? { configDir: options.configDir } : {}),
                mode: "manual-rebuild",
                ...(request.generatedBy ? { generatedBy: request.generatedBy } : {}),
                ...(request.reason ? { reason: request.reason } : {}),
                ...(options.planArtifactTestFaults ? { testFaults: options.planArtifactTestFaults } : {}),
              });

              planArtifactSelfCheckFailure = undefined;
              planArtifactSelfCheckHealthy = true;
              planArtifactSelfCheckWarnings = extractPlanArtifactWarnings(rebuilt as unknown as Record<string, unknown>);
              return toToolOutput({
                ok: true,
                action: request.action,
                applied: true,
                indexPath: rebuilt.indexPath,
                scannedFileCount: rebuilt.scannedFileCount,
                rebuiltRecordCount: rebuilt.rebuiltRecordCount,
                status: rebuilt.status,
                mode: rebuilt.mode,
                ...(planArtifactSelfCheckWarnings ?? {}),
              });
            }

            if (planArtifactSelfCheckFailure) {
              return toToolOutput({
                ok: false,
                action: request.action,
                applied: false,
                code: planArtifactSelfCheckFailure.code,
                message: planArtifactSelfCheckFailure.message,
              });
            }

            const sessionContext = request.operation === "update"
              ? await resolveUpdatePlanArtifactSession(request, options.configDir)
              : (runtimePlanArtifactSession ?? createRuntimePlanArtifactSession());
            runtimePlanArtifactSession = sessionContext;
            const result = await writePlanArtifact({
              projectRoot: resolveProjectRoot(context),
              action: request.action,
              operation: request.operation,
              systemIdentity: {
                sessionKey: sessionContext.sessionKey,
                sessionStartedAt: sessionContext.sessionStartedAt,
              },
              generatedBy: request.generatedBy,
              ...(request.title ? { title: request.title } : {}),
              ...(request.markdown ? { markdown: request.markdown } : {}),
              ...(request.filenameHint ? { filenameHint: request.filenameHint } : {}),
              ...(request.sourceSessionKey ? { sourceSessionKey: request.sourceSessionKey } : {}),
              ...(request.sourcePlanRef ? { sourcePlanRef: request.sourcePlanRef } : {}),
              ...(request.replacesSessionKey ? { replacesSessionKey: request.replacesSessionKey } : {}),
              ...(request.replacesPlanRef ? { replacesPlanRef: request.replacesPlanRef } : {}),
              ...(request.status ? { status: request.status } : {}),
              ...(request.maturityLevel ? { maturityLevel: request.maturityLevel } : {}),
              ...(request.targetPlanRef ? { targetPlanRef: request.targetPlanRef } : {}),
              ...(options.configDir ? { configDir: options.configDir } : {}),
            });
            const resultWarnings = mergePlanArtifactWarnings(
              selfCheckWarnings,
              extractPlanArtifactWarnings(result as unknown as Record<string, unknown>),
            );

            return toToolOutput({
              ok: true,
              action: request.action,
              applied: true,
              planId: result.planId,
              path: result.path,
              indexPath: result.indexPath,
              sessionKey: result.sessionKey,
              bytes: result.bytes,
              status: result.status,
              operation: result.operation,
              rebuildTriggered: result.rebuildTriggered,
              ...(resultWarnings ?? {}),
            });
          } catch (error) {
            return toToolOutput(parsePlanArtifactError(error, requestedAction));
          }
        },
      },
      bounded_lite_background: {
        description: "List currently tracked background tasks from the bounded coordinator.",
        args: {},
        async execute() {
          return formatToolJsonOutput(background.list());
        },
      },
      bounded_lite_runtime_profile: {
        description: "Report the current runtime profile without creating a second control plane.",
        args: {},
        async execute() {
          return formatToolJsonOutput(runtimeProfile);
        },
      },
      bounded_lite_study_ingest: {
        description: "Discover first-level .ppt, .pptx, and .pdf courseware in the current directory and return a structured study source index with low-text and recoverable-blocker reports. Passing a directory outside the current OpenCode working directory requires allowExternalDirectory=true after explicit user authorization.",
        args: {},
        async execute(args, context) {
          return formatToolJsonOutput(await ingestStudyCourseware(resolveStudyDirectory(args, context)));
        },
      },
      bounded_lite_study_package: {
        description: "Generate the current-directory /study review project files from first-level courseware while preserving AGENTS.md managed-block safety. Use stage=sources for a source-index/notes-only pass before full review generation. Passing a directory outside the current OpenCode working directory requires allowExternalDirectory=true after explicit user authorization.",
        args: {},
        async execute(args, context) {
          return formatToolJsonOutput(await generateStudyPackage(resolveStudyDirectory(args, context), readStudyPackageStage(args)));
        },
      },
      bounded_lite_model_config: {
        description: `Import, list, recommend, or update per-role and Task Lead profile OpenCode models for Oh My Lite OpenAgent.

Actions:
	- import: Import all available OpenCode model providers by default. Call with { "action": "import" }.
- list: Show current role model assignments and available provider models. Call with { "action": "list" }.
- auto: Show the imported model pool first, then recommend role and Task Lead profile model assignments from that pool based on capability needs. This does not write config. Call with { "action": "auto" }.
- apply: Manually assign specific models, reasoning effort, or profile models. Call with { "action": "apply", "assignments": { "role-name": "provider/model-id" }, "reasoningEffortAssignments": { "command-lead": "high" }, "taskLeadProfileAssignments": { "code": "provider/model-id" } }.

Policy:
	- source and providerPreference are optional narrowing filters; by default the imported pool includes every discovered provider.
- allowCodexBackend defaults to false.
- familyPreference can limit the imported pool, for example { "familyPreference": ["gpt"] } for GPT-family subscription models.
- reasoningEffortAssignments supports minimal, low, medium, or high and writes agent.<role>.reasoningEffort for providers/models that support that option.

Role capability summary:
- command-lead (orchestration): needs strongest reasoning
- plan-builder (planning): needs strong reasoning + structured output
- deep-plan-builder (advisory-planning): detailed plans for lower-strength executors, has mandatory plan review
- task-lead (execution): mid-tier models sufficient
- explore (fast-retrieval): fast, cheap models preferred
- librarian (fast-retrieval): fast, cheap models preferred
- plan-review (critical-review): needs strongest reasoning to catch errors
- result-review (critical-review): needs strongest reasoning to verify completeness

Task Lead profile summary:
- quick: fast low-risk execution
- code: bounded implementation and tests
- research/docs: repository or external API understanding
- writing: docs and prose
- visual/multimodal: UI or visual verification
- deep/large-context: difficult or large-context execution
- risk-high/security/migration: high-risk changes requiring stronger reasoning

AI selection rule:
- Only choose model IDs returned by action=import or the imported pool used by action=auto.
- For reasoning effort, prefer the JSON returned by action=auto, then let the user adjust low/medium/high per role before applying.
- After action=auto, ask the user whether they want to modify the recommendations before calling action=apply.

If no provider models are found, tell the user to configure or connect OpenCode providers first.`,
        args: {
          action: tool.schema.enum(["import", "list", "auto", "apply"]),
          assignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          reasoningEffortAssignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          taskLeadProfileAssignments: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          policy: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
          source: tool.schema.string().optional(),
          providerPreference: tool.schema.array(tool.schema.string()).optional(),
          familyPreference: tool.schema.array(tool.schema.string()).optional(),
          allowCodexBackend: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          const fallbackAction = inferModelConfigAction(args);

          try {
            const request = parseModelConfigRequest(args);
            const action = request.action;
            const config = await readOpenCodeConfig(options.configDir);
            const liteConfig = await readLiteConfigFile(options.configDir, config);
            const effectiveConfig = withLiteConfigAppliedToOpenCodeConfig(
              withConfiguredTaskLeadProfiles(config, options),
              liteConfig,
            );
            const credentialProviderIds = await readOpenCodeAuthProviderIds();
            const runtimeModels = await listRuntimeProviderModels(context);
            const modelsDevModels = await listModelsDevProviderModels(credentialProviderIds);
            const credentialModels = listKnownModelsForCredentialProviders(
              credentialProviderIds,
            );
            const configModels = listProviderModels(effectiveConfig);
            const discoveredPool = buildDiscoveredModelPool({
              runtimeModels,
              connectedProviderIds: credentialProviderIds,
              modelsDevModels,
              credentialFallbackModels: credentialModels,
              configuredModels: configModels,
            });
            const models = discoveredPool.models;
            const inferredPolicy = inferModelPoolPolicy(effectiveConfig, readModelPoolPolicy(request));
            const poolPolicy = inferredPolicy.policy;
            const importedPool = importModelPool(models, poolPolicy);

            if (action === "import") {
              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(importedPool),
                report: [
                  inferredPolicy.reason,
                  "",
                  formatModelImportReport({
                    models: importedPool,
                    policy: poolPolicy,
                  }),
                ].join("\n"),
              } satisfies ModelConfigResponse);
            }

            if (action === "list") {
              const roleSummaries = summarizeRoleModels(effectiveConfig);
              const profileSummaries = summarizeTaskLeadProfileModels(effectiveConfig);
              const roleAssignments = Object.fromEntries(
                roleSummaries
                  .filter((role) => typeof role.effectiveModel === "string")
                  .map((role) => [role.role, role.effectiveModel as string]),
              );
              const profileAssignments = Object.fromEntries(
                profileSummaries
                  .filter((profile) => typeof profile.effectiveModel === "string")
                  .map((profile) => [profile.profile, profile.effectiveModel as string]),
              );

              const report = models.length === 0
                ? [
                  "Oh My Lite OpenAgent role model configuration",
                  "",
                  "Current role models:",
                  ...roleSummaries.map((role) => {
                    const source = role.inheritsGlobal ? "inherits global" : "configured";
                    return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
                  }),
                  "",
                  "Available provider models:",
                  "- <none found>",
                  "",
                  "No provider models were detected from either runtime or config.",
                ].join("\n")
                : formatModelConfigReport({
                  roles: roleSummaries,
                  taskLeadProfiles: profileSummaries,
                  models,
                });

              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(models),
                role_assignments: roleAssignments,
                profile_assignments: profileAssignments,
                report,
              } satisfies ModelConfigResponse);
            }

            if (action === "auto") {
              const autoResult = resolveAutoModels(importedPool, effectiveConfig);
              const profileAutoResult = resolveAutoTaskLeadProfileModels(importedPool);
              const reasoningEffortAssignments = resolveAutoReasoningEffortAssignments(autoResult.assignments);

              const report = importedPool.length === 0 && autoResult.resolved.length === 0 && profileAutoResult.resolved.length === 0
                ? [
                  "Oh My Lite OpenAgent auto model configuration",
                  "",
                  "No imported models found to recommend.",
                  "",
                  inferredPolicy.reason,
                  "",
                  formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                ].join("\n")
                : [
                  "Oh My Lite OpenAgent /agent-models one-stop discovery and recommendation",
                  "",
                  inferredPolicy.reason,
                  "",
                  "Available imported model pool (review before recommendations):",
                  formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                  "",
                  formatAutoModelReport(autoResult),
                  "",
                  formatTaskLeadProfileModelReport(profileAutoResult),
                ].join("\n");

              return toToolOutput({
                ok: true,
                action,
                applied: false,
                changed_keys: [],
                available_models: toAvailableModels(importedPool),
                recommendations: {
                  roles: autoResult.assignments,
                  taskLeadProfiles: profileAutoResult.assignments,
                  reasoningEffort: reasoningEffortAssignments,
                },
                role_assignments: autoResult.assignments,
                profile_assignments: profileAutoResult.assignments,
                reasoning_effort_assignments: reasoningEffortAssignments,
                report,
              } satisfies ModelConfigResponse);
            }

            if (action === "apply") {
              const assignments = request.assignments;
              const taskLeadProfileAssignments = request.taskLeadProfileAssignments;
              const roleModelAssignments = readRoleModelAssignments(assignments);
              const reasoningEffortAssignments = mergeRecordAssignments(
                readEmbeddedReasoningEffortAssignments(assignments),
                request.reasoningEffortAssignments,
              );

              const hasRoleAssignments = Object.keys(roleModelAssignments).length > 0;
              const hasReasoningAssignments = Object.keys(reasoningEffortAssignments).length > 0;
              const hasProfileAssignments = typeof taskLeadProfileAssignments === "object" &&
                taskLeadProfileAssignments !== null &&
                !Array.isArray(taskLeadProfileAssignments);

              if (!hasRoleAssignments && !hasProfileAssignments && !hasReasoningAssignments) {
                return toToolOutput({
                  ok: false,
                  action,
                  applied: false,
                  changed_keys: [],
                  validation_errors: [{
                    field: "apply",
                    code: "MODELCFG_ERR_INVALID_PAYLOAD",
                    message: "bounded_lite_model_config apply requires assignments, reasoningEffortAssignments, or taskLeadProfileAssignments.",
                  }],
                } satisfies ModelConfigResponse);
              }

              const hasAnyDiscoveredPoolSource =
                importedPool.length > 0 ||
                models.length > 0 ||
                runtimeModels.length > 0 ||
                modelsDevModels.length > 0 ||
                credentialModels.length > 0 ||
                configModels.length > 0;

              if ((hasRoleAssignments || hasProfileAssignments) && !hasAnyDiscoveredPoolSource) {
                return toToolOutput({
                  ok: false,
                  action,
                  applied: false,
                  changed_keys: [],
                  validation_errors: [{
                    field: "apply",
                    code: "MODELCFG_ERR_POOL_UNAVAILABLE",
                    message: "unable to build a model pool for apply.",
                  }],
                } satisfies ModelConfigResponse);
              }

              const result = hasRoleAssignments ? applyLiteRoleModelConfig(
                liteConfig,
                roleModelAssignments,
                importedPool.map((model) => model.id),
                { allowUnavailableModels: request.allowUnavailableModels !== false },
              ) : { changed: [], skipped: [], warnings: [] };
              const reasoningResult = hasReasoningAssignments ? applyLiteRoleReasoningEffortConfig(
                liteConfig,
                reasoningEffortAssignments,
              ) : { changed: [], skipped: [] };
              const profileResult = hasProfileAssignments ? applyLiteTaskLeadProfileModelConfig(
                liteConfig,
                taskLeadProfileAssignments as Record<string, unknown>,
                importedPool.map((model) => model.id),
                { allowUnavailableModels: request.allowUnavailableModels !== false },
              ) : { changed: [], skipped: [], warnings: [] };
              const liteConfigPath = await writeLiteConfigFile(liteConfig, options.configDir);
              const updatedAgents = await updateGeneratedAgentMarkdownFiles(liteConfig, options.configDir);
              const updatedEffectiveConfig = withLiteConfigAppliedToOpenCodeConfig(
                withConfiguredTaskLeadProfiles(config, options),
                liteConfig,
              );
              const changedKeys = collectChangedKeys({
                roleChanged: result.changed,
                profileChanged: profileResult.changed,
                reasoningChanged: reasoningResult.changed,
              });

              const warnings = [
                ...result.warnings.map((item) => `${item.role}: ${item.warning}`),
                ...profileResult.warnings.map((item) => `${item.profile}: ${item.warning}`),
                ...result.skipped.map((item) => `${item.role}: ${item.reason}`),
                ...profileResult.skipped.map((item) => `${item.profile}: ${item.reason}`),
                ...reasoningResult.skipped.map((item) => `${item.role}: ${item.reason}`),
              ];

              return toToolOutput({
                ok: true,
                action,
                applied: changedKeys.length > 0,
                changed_keys: changedKeys,
                ...(warnings.length > 0 ? { warnings } : {}),
                available_models: toAvailableModels(importedPool),
                role_assignments: Object.fromEntries(
                  summarizeRoleModels(updatedEffectiveConfig)
                    .filter((role) => typeof role.effectiveModel === "string")
                    .map((role) => [role.role, role.effectiveModel as string]),
                ),
                profile_assignments: Object.fromEntries(
                  summarizeTaskLeadProfileModels(updatedEffectiveConfig)
                    .filter((profile) => typeof profile.effectiveModel === "string")
                    .map((profile) => [profile.profile, profile.effectiveModel as string]),
                ),
                reasoning_effort_assignments: Object.fromEntries(
                  summarizeRoleModels(updatedEffectiveConfig)
                    .filter((role) => typeof role.configuredReasoningEffort === "string")
                    .map((role) => [role.role, role.configuredReasoningEffort as "minimal" | "low" | "medium" | "high"]),
                ),
                report: [
                  formatModelConfigReport({
                    roles: summarizeRoleModels(updatedEffectiveConfig),
                    taskLeadProfiles: summarizeTaskLeadProfileModels(updatedEffectiveConfig),
                    models: importedPool,
                    changed: result.changed,
                    skipped: result.skipped,
                    warnings: result.warnings,
                    profileChanged: profileResult.changed,
                    profileSkipped: profileResult.skipped,
                    profileWarnings: profileResult.warnings,
                    reasoningChanged: reasoningResult.changed,
                    reasoningSkipped: reasoningResult.skipped,
                  }),
                  "",
                  `Updated ${liteConfigPath}.`,
                  `Updated agent markdown files: ${updatedAgents.length > 0 ? updatedAgents.join(", ") : "none"}.`,
                  "Restart OpenCode or start a new session if the active TUI keeps old model state.",
                ].join("\n"),
              } satisfies ModelConfigResponse);
            }

            throw new Error("MODELCFG_ERR_UNKNOWN_ACTION: action must be import, list, auto, or apply.");
          } catch (error) {
            return toToolOutput(parseModelConfigError(error, fallbackAction));
          }
        },
      },
    },
    async "permission.ask"(input, output) {
      if (input.tool.startsWith("bounded_lite_")) {
        output.status = "allow";
      }
    },
    "tool.execute.before"(input, output) {
      if (input.tool === "task" && isRecord(output.args)) {
        const command = readString(output.args["command"]);
        const prompt = readString(output.args["prompt"]);
        if (command === "/agent-models" || prompt === "/agent-models") {
          throw new Error("/agent-models must be executed directly by command-lead; task delegation is forbidden.");
        }
      }

      if (input.tool === "bounded_lite_route") {
        output.args = { ...output.args };
      }
    },
    async "tool.execute.after"(_input, output) {
      output.output = output.output;
    },
  };
}

export default createBoundedLitePlugin;
