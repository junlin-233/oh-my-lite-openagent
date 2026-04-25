import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PLAN_ARTIFACT_DIR,
  PLAN_INDEX_FILE,
  sanitizeSlug,
  writePlanArtifact,
} from "../../.opencode/lib/runtime/plan-artifact.js";

describe("plan artifact persistence", () => {
  it("writes plans under .liteagent/plans and appends the index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liteagent-plan-"));
    const result = await writePlanArtifact({
      projectRoot: root,
      title: "Router Threshold Fix",
      markdown: "---\nplan_schema_version: 2.1\n---\n\n# Plan\n",
      now: new Date("2026-04-25T01:02:03.000Z"),
      artifactKind: "detailed-plan",
      maturityLevel: "M2",
      generatedBy: "deep-plan-builder",
    });

    expect(result.relativePath).toBe(`${PLAN_ARTIFACT_DIR}/2026-04-25-router-threshold-fix.md`);
    expect(await readFile(path.join(root, result.relativePath), "utf8")).toContain("plan_schema_version: 2.1");

    const index = await readFile(path.join(root, PLAN_INDEX_FILE), "utf8");
    expect(index).toContain('"artifact_kind":"detailed-plan"');
    expect(index).toContain('"generated_by":"deep-plan-builder"');
  });

  it("rejects requested paths outside .liteagent/plans", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liteagent-plan-"));

    await expect(writePlanArtifact({
      projectRoot: root,
      title: "Bad Path",
      markdown: "# Plan",
      requestedPath: "../bad.md",
    })).rejects.toThrow(/cannot traverse|must start/);
  });

  it("normalizes non-ascii or unsafe slugs to a safe fallback", () => {
    expect(sanitizeSlug("修复 模型导入!")).toBe("plan");
    expect(sanitizeSlug("Agent Models Import Fix")).toBe("agent-models-import-fix");
  });
});
