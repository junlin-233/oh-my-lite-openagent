import { MAX_CHILD_ORCHESTRATOR_DEPTH, ROLE_CONTRACTS, type RoutingCategory } from "../lib/contracts.js";
import { BackgroundCoordinator } from "../lib/runtime/background.js";
import {
  type PluginHooks,
  type PluginInput,
} from "../lib/runtime/plugin-types.js";
import { resolveCategoryRoute } from "../lib/runtime/categories.js";
import { buildTaskDAG, type TaskDispatchConfig } from "../lib/runtime/plan-dag.js";
import { parseJsonConfig } from "../lib/runtime/jsonc.js";
import { validatePlanReadiness } from "../lib/runtime/plan-readiness.js";
import { writePlanArtifact } from "../lib/runtime/plan-artifact.js";
import { createRuntimeProfile } from "../lib/runtime/safety.js";
import {
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
  LITE_CONFIG_FILE,
  migrateLiteConfigFromOpenCodeConfig,
  readLiteConfig,
  type LiteOpenAgentConfig,
  withLiteConfigAppliedToOpenCodeConfig,
} from "../lib/runtime/lite-config.js";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
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
}

export interface NormalizedBoundedLitePluginOptions {
  mode: "full" | "degraded";
  enableHooks: boolean;
  enableBackground: boolean;
  enableBundledMcp: boolean;
  maxChildDepth: number;
  configDir?: string;
  taskLeadProfiles?: Record<string, unknown>;
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
      ? { taskLeadProfiles: options.taskLeadProfiles }
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
    await writeStudyFile("study-guide.md", `# Study Guide\n\nUse \`exam-points.md\`, \`practice-questions.md\`, and per-deck summaries for final review.\n`);
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
      // Fall back to the built-in literal text extractor.
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
        // Keep searching PATH.
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
  if (isRecord(pluginOptions["taskLeadProfiles"])) return pluginOptions["taskLeadProfiles"];
  if (isRecord(options.taskLeadProfiles)) return options.taskLeadProfiles;
  return isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {};
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
    taskLeadProfiles,
  }));
  delete config["taskLeadProfiles"];
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
  const updateKeys = new Set(Object.keys(updates));
  const lines = frontmatter.split("\n").filter((line) => {
    const key = line.split(":", 1)[0]?.trim();
    return key ? !updateKeys.has(key) : true;
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
  const timeout = setTimeout(() => controller.abort(), 1_000);

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

function readModelPoolPolicy(args: Record<string, unknown>): ModelPoolPolicy {
  const policy = isRecord(args["policy"]) ? args["policy"] : {};
  const sourceValue = typeof policy["source"] === "string"
    ? policy["source"]
    : typeof args["source"] === "string"
      ? args["source"]
      : undefined;
  const source = isModelSourceFilter(sourceValue) ? sourceValue : undefined;
  const providerPreference = readStringArray(policy["providerPreference"] ?? args["providerPreference"]);
  const familyPreference = readFamilyArray(policy["familyPreference"] ?? args["familyPreference"]);
  const allowCodexBackend = typeof policy["allowCodexBackend"] === "boolean"
    ? policy["allowCodexBackend"]
    : typeof args["allowCodexBackend"] === "boolean"
      ? args["allowCodexBackend"]
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

function formatToolJsonOutput(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function createBoundedLitePlugin(
  _input: PluginInput,
  rawOptions?: Record<string, unknown>,
): Promise<PluginHooks> {
  const options = normalizePluginOptions(rawOptions as BoundedLitePluginOptions | undefined);
  const runtimeProfile = createRuntimeProfile({
    pluginEnabled: options.mode === "full",
    hooksEnabled: options.enableHooks,
    backgroundEnabled: options.enableBackground,
    bundledMcpEnabled: options.enableBundledMcp,
  });
  const background = new BackgroundCoordinator();

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
        description: "Persist a Command Lead-approved plan artifact under .liteagent/plans and append .liteagent/plan-index.jsonl.",
        async execute(args, context) {
          const action = readString(args["action"]) ?? "write";
          if (action !== "write") {
            throw new Error("bounded_lite_plan_artifact action must be write.");
          }

          const title = readString(args["title"]);
          const markdown = readString(args["markdown"]) ?? readString(args["content"]);
          if (!title || !markdown) {
            throw new Error("bounded_lite_plan_artifact write requires title and markdown.");
          }

          const planId = readString(args["planId"]) ?? readString(args["plan_id"]);
          const maturityLevel = readString(args["maturityLevel"]) ?? readString(args["maturity_level"]);
          const generatedBy = readString(args["generatedBy"]) ?? readString(args["generated_by"]);
          const requestedPath = readString(args["path"]) ?? readString(args["recommended_plan_path"]);
          const result = await writePlanArtifact({
            projectRoot: resolveProjectRoot(context),
            title,
            markdown,
            artifactKind: args["artifactKind"] === "detailed-plan" ? "detailed-plan" : "plan-skeleton",
            status: args["status"] === "reviewed" || args["status"] === "blocked" ? args["status"] : "draft",
            overwrite: args["overwrite"] === true,
            ...(planId ? { planId } : {}),
            ...(maturityLevel ? { maturityLevel } : {}),
            ...(generatedBy ? { generatedBy } : {}),
            ...(requestedPath ? { requestedPath } : {}),
          });

          return [
            "Oh My Lite OpenAgent plan artifact persisted",
            "",
            `Plan ID: ${result.planId}`,
            `Path: ${result.relativePath}`,
            `Index: .liteagent/plan-index.jsonl`,
            `Bytes: ${result.bytes}`,
            `Overwritten: ${result.overwritten ? "yes" : "no"}`,
          ].join("\n");
        },
      },
      bounded_lite_background: {
        description: "List currently tracked background tasks from the bounded coordinator.",
        async execute() {
          return formatToolJsonOutput(background.list());
        },
      },
      bounded_lite_runtime_profile: {
        description: "Report the current runtime profile without creating a second control plane.",
        async execute() {
          return formatToolJsonOutput(runtimeProfile);
        },
      },
      bounded_lite_study_ingest: {
        description: "Discover first-level .ppt, .pptx, and .pdf courseware in the current directory and return a structured study source index with low-text and recoverable-blocker reports. Passing a directory outside the current OpenCode working directory requires allowExternalDirectory=true after explicit user authorization.",
        async execute(args, context) {
          return formatToolJsonOutput(await ingestStudyCourseware(resolveStudyDirectory(args, context)));
        },
      },
      bounded_lite_study_package: {
        description: "Generate the current-directory /study review project files from first-level courseware while preserving AGENTS.md managed-block safety. Use stage=sources for a source-index/notes-only pass before full review generation. Passing a directory outside the current OpenCode working directory requires allowExternalDirectory=true after explicit user authorization.",
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
        async execute(args, context) {
          const action = typeof args["action"] === "string" ? args["action"] : "list";
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
          const models = mergeProviderModels(
            mergeProviderModels(mergeProviderModels(runtimeModels, modelsDevModels), credentialModels),
            listProviderModels(effectiveConfig),
          );
          const inferredPolicy = inferModelPoolPolicy(effectiveConfig, readModelPoolPolicy(args));
          const poolPolicy = inferredPolicy.policy;
          const importedPool = importModelPool(models, poolPolicy);

          if (action === "import") {
            return [
              inferredPolicy.reason,
              "",
              formatModelImportReport({
                models: importedPool,
                policy: poolPolicy,
              }),
            ].join("\n");
          }

          if (action === "list") {
            const roleLines = summarizeRoleModels(effectiveConfig).map((role) => {
              const source = role.inheritsGlobal ? "inherits global" : "configured";
              return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
            });

	            const configModels = listProviderModels(effectiveConfig);
	            const debugLines = [
	              `Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
	              `Models.dev fallback models: ${modelsDevModels.length > 0 ? modelsDevModels.map((m) => m.id).join(", ") : "none"}`,
	              `Credential fallback models: ${credentialModels.length > 0 ? credentialModels.map((m) => m.id).join(", ") : "none"}`,
	              `Config-inferred models: ${configModels.length > 0 ? configModels.map((m) => m.id).join(", ") : "none"}`,
	            ];

            if (models.length === 0) {
              return [
                "Oh My Lite OpenAgent role model configuration",
                "",
                "Current role models:",
                ...roleLines,
                "",
                "Available provider models:",
                "- <none found>",
                "",
                "Debug info:",
                ...debugLines,
                "",
                "No provider models were detected from either runtime or config.",
                "This usually means your OpenCode provider configuration is stored",
                "in the internal credential store (via /connect) rather than in",
                "opencode.json's \"provider\" key.",
                "",
                "Since you already have models assigned to roles above, you can:",
                "1. Use action=import to inspect the eligible inferred model pool.",
                "2. Use action=apply only with model IDs returned by action=import.",
                '   { "action": "apply", "assignments": { "command-lead": "provider/model" } }',
              ].join("\n");
            }

            return formatModelConfigReport({
              roles: summarizeRoleModels(effectiveConfig),
              taskLeadProfiles: summarizeTaskLeadProfileModels(effectiveConfig),
              models,
            });
          }

          if (action === "auto") {
            const autoResult = resolveAutoModels(importedPool, effectiveConfig);
            const profileAutoResult = resolveAutoTaskLeadProfileModels(importedPool);
            const reasoningEffortAssignments = resolveAutoReasoningEffortAssignments(autoResult.assignments);

            if (importedPool.length === 0 && autoResult.resolved.length === 0 && profileAutoResult.resolved.length === 0) {
              const roleLines = summarizeRoleModels(effectiveConfig).map((role) => {
                const source = role.inheritsGlobal ? "inherits global" : "configured";
                return `- ${role.role}: ${role.effectiveModel ?? "<unset>"} (${source})`;
              });

	              const configModels = listProviderModels(effectiveConfig);

	              const helpLines = [
                "Oh My Lite OpenAgent auto model configuration",
                "",
                "No imported models found to recommend.",
                "",
                inferredPolicy.reason,
                "",
                formatModelImportReport({ models: importedPool, policy: poolPolicy }),
                "",
                "Current role models:",
                ...roleLines,
                "",
	                "Debug info:",
	                `  Runtime provider models: ${runtimeModels.length > 0 ? runtimeModels.map((m) => m.id).join(", ") : "none"}`,
	                `  Models.dev fallback models: ${modelsDevModels.length > 0 ? modelsDevModels.map((m) => m.id).join(", ") : "none"}`,
	                `  Credential fallback models: ${credentialModels.length > 0 ? credentialModels.map((m) => m.id).join(", ") : "none"}`,
	                `  Config-inferred models: ${configModels.length > 0 ? configModels.map((m) => m.id).join(", ") : "none"}`,
                "",
                "Use action=import first to inspect the available pool.",
                "The default pool includes every discovered provider unless policy overrides are provided.",
              ];

              return helpLines.join("\n");
            }

            const assignments = autoResult.assignments;
            const taskLeadProfileAssignments = profileAutoResult.assignments;
            const reportLines = [
              inferredPolicy.reason,
              "",
              "Available imported model pool (review before recommendations):",
              formatModelImportReport({
                models: importedPool,
                policy: poolPolicy,
              }),
              "",
              formatAutoModelReport(autoResult),
              "",
              formatTaskLeadProfileModelReport(profileAutoResult),
              "",
              formatModelConfigReport({
                roles: summarizeRoleModels(effectiveConfig),
                taskLeadProfiles: summarizeTaskLeadProfileModels(effectiveConfig),
                models: importedPool,
              }),
              "",
              "Recommended assignments JSON:",
              JSON.stringify(assignments, null, 2),
              "",
              "Recommended Task Lead profile assignments JSON:",
              JSON.stringify(taskLeadProfileAssignments, null, 2),
              "",
              "Recommended reasoning effort assignments JSON:",
              JSON.stringify(reasoningEffortAssignments, null, 2),
              "",
              "Preview only. Ask the user whether they want to modify these assignments, then call action=apply to write them.",
            ];

            return reportLines.join("\n");
          }

          if (action === "apply") {
            const assignments = args["assignments"];
            const taskLeadProfileAssignments = args["taskLeadProfileAssignments"] ?? args["profileAssignments"];
            const roleModelAssignments = readRoleModelAssignments(assignments);
            const reasoningEffortAssignments = mergeRecordAssignments(
              readEmbeddedReasoningEffortAssignments(assignments),
              args["reasoningEffortAssignments"] ?? args["reasoningAssignments"],
            );
            const profileReasoningEffortAssignments = mergeRecordAssignments(
              {},
              args["taskLeadProfileReasoningEffortAssignments"] ?? args["profileReasoningEffortAssignments"],
            );

            const hasRoleAssignments = Object.keys(roleModelAssignments).length > 0;
            const hasReasoningAssignments = Object.keys(reasoningEffortAssignments).length > 0;
            const hasProfileAssignments = typeof taskLeadProfileAssignments === "object" &&
              taskLeadProfileAssignments !== null &&
              !Array.isArray(taskLeadProfileAssignments);
            const hasProfileReasoningAssignments = Object.keys(profileReasoningEffortAssignments).length > 0;

            if (!hasRoleAssignments && !hasProfileAssignments && !hasReasoningAssignments && !hasProfileReasoningAssignments) {
              throw new Error(
                "bounded_lite_model_config apply requires assignments, reasoningEffortAssignments, taskLeadProfileAssignments, or taskLeadProfileReasoningEffortAssignments.",
              );
            }

            const result = hasRoleAssignments ? applyLiteRoleModelConfig(
              liteConfig,
              roleModelAssignments,
              importedPool.map((model) => model.id),
              {
                allowUnavailableModels: args["allowUnavailableModels"] === true,
              },
            ) : { changed: [], skipped: [], warnings: [] };
            const reasoningResult = hasReasoningAssignments ? applyLiteRoleReasoningEffortConfig(
              liteConfig,
              reasoningEffortAssignments,
            ) : { changed: [], skipped: [] };
            const profileLiteResult = hasProfileAssignments ? applyLiteTaskLeadProfileModelConfig(
              liteConfig,
              taskLeadProfileAssignments as Record<string, unknown>,
              importedPool.map((model) => model.id),
              {
                allowUnavailableModels: args["allowUnavailableModels"] === true,
              },
            ) : { changed: [], skipped: [], warnings: [] };
            const profileReasoningResult = hasProfileReasoningAssignments ? applyLiteTaskLeadProfileReasoningEffortConfig(
              liteConfig,
              profileReasoningEffortAssignments,
            ) : { changed: [], skipped: [] };
            const liteConfigPath = await writeLiteConfigFile(liteConfig, options.configDir);
            const updatedAgents = await updateGeneratedAgentMarkdownFiles(liteConfig, options.configDir);
            const updatedEffectiveConfig = withLiteConfigAppliedToOpenCodeConfig(
              withConfiguredTaskLeadProfiles(config, options),
              liteConfig,
            );

            return [
              formatModelConfigReport({
                roles: summarizeRoleModels(updatedEffectiveConfig),
                taskLeadProfiles: summarizeTaskLeadProfileModels(updatedEffectiveConfig),
                models: importedPool,
                changed: result.changed,
                skipped: result.skipped,
                warnings: result.warnings,
                profileChanged: profileLiteResult.changed,
                profileSkipped: profileLiteResult.skipped,
                profileWarnings: profileLiteResult.warnings,
                reasoningChanged: reasoningResult.changed,
                reasoningSkipped: reasoningResult.skipped,
              }),
              ...(profileReasoningResult.changed.length > 0
                ? [
                  "",
                  "Task Lead profile reasoning effort changes applied:",
                  ...profileReasoningResult.changed.map((change) => (
                    `- ${change.profile}: ${change.previous ?? "<unset>"} -> ${change.next}${change.requested ? ` (requested ${change.requested})` : ""}`
                  )),
                ]
                : []),
              ...(profileReasoningResult.skipped.length > 0
                ? [
                  "",
                  "Task Lead profile reasoning effort skipped:",
                  ...profileReasoningResult.skipped.map((item) => `- ${item.profile}: ${item.reason}`),
                ]
                : []),
              "",
              `Updated ${liteConfigPath}.`,
              `Updated agent markdown files: ${updatedAgents.length > 0 ? updatedAgents.join(", ") : "none"}.`,
              "Restart OpenCode or start a new session if the active TUI keeps old model state.",
            ].join("\n");
          }

          throw new Error("bounded_lite_model_config action must be import, list, auto, or apply.");
        },
      },
    },
    async "permission.ask"(input, output) {
      if (input.tool.startsWith("bounded_lite_")) {
        output.status = "allow";
      }
    },
    async "tool.execute.before"(input, output) {
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
