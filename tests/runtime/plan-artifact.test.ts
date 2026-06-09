import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OPENPLAN_DIR,
  OPENPLAN_INDEX_FILE,
  parseFrontmatter,
  rebuildOpenPlanIndex,
  sanitizeSlug,
  writePlanArtifact,
} from "../../.opencode/lib/runtime/plan-artifact.js";

describe("openplan plan artifact persistence", () => {
  const sessionKey = "20260518-1030-a1b2c3d4";
  const sessionStartedAt = "2026-05-18T02:30:00Z";
  const otherSessionKey = "20260518-1130-z9y8x7w6";
  const otherSessionStartedAt = "2026-05-18T03:30:00Z";

  async function withConfigDir<T>(configDir: string, run: () => Promise<T>): Promise<T> {
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = configDir;

    try {
      return await run();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.OPENCODE_CONFIG_DIR;
      } else {
        process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
      }
    }
  }

  async function createPlan(options: {
    root: string;
    configDir: string;
    title?: string;
    markdown?: string;
    filenameHint?: string;
    generatedBy?: string;
    planId?: string;
    maturityLevel?: string;
    sessionKey?: string;
    sessionStartedAt?: string;
    now?: Date;
    status?: "draft" | "reviewed" | "blocked";
    sourceSessionKey?: string;
    sourcePlanRef?: string;
    replacesSessionKey?: string;
    replacesPlanRef?: string;
    testFaults?: {
      failPlanWrite?: boolean;
      failReplacementTargetWrite?: boolean;
      failIndexWriteOnce?: boolean;
      failRebuild?: boolean;
    };
  }) {
    return writePlanArtifact({
      projectRoot: options.root,
      configDir: options.configDir,
      action: "write",
      operation: "create",
      title: options.title ?? "Plan",
      markdown: options.markdown ?? "# Plan",
      systemIdentity: {
        sessionKey: options.sessionKey ?? sessionKey,
        sessionStartedAt: options.sessionStartedAt ?? sessionStartedAt,
        ...(options.planId ? { planId: options.planId } : {}),
      },
      filenameHint: options.filenameHint ?? "plan.md",
      generatedBy: options.generatedBy ?? "command-lead",
      ...(options.maturityLevel ? { maturityLevel: options.maturityLevel } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.sourceSessionKey ? { sourceSessionKey: options.sourceSessionKey } : {}),
      ...(options.sourcePlanRef ? { sourcePlanRef: options.sourcePlanRef } : {}),
      ...(options.replacesSessionKey ? { replacesSessionKey: options.replacesSessionKey } : {}),
      ...(options.replacesPlanRef ? { replacesPlanRef: options.replacesPlanRef } : {}),
      ...(options.testFaults ? { testFaults: options.testFaults } : {}),
    });
  }

  async function updatePlan(options: {
    root: string;
    configDir: string;
    markdown?: string;
    status?: "draft" | "reviewed" | "blocked";
    title?: string;
    maturityLevel?: string;
    targetPlanRef?: string;
    generatedBy?: string;
    sessionKey?: string;
    sessionStartedAt?: string;
    now?: Date;
    testFaults?: {
      failUpdateReplace?: boolean;
      failIndexWriteOnce?: boolean;
      failRebuild?: boolean;
    };
  }) {
    return writePlanArtifact({
      projectRoot: options.root,
      configDir: options.configDir,
      action: "write",
      operation: "update",
      systemIdentity: {
        sessionKey: options.sessionKey ?? sessionKey,
        sessionStartedAt: options.sessionStartedAt ?? sessionStartedAt,
      },
      generatedBy: options.generatedBy ?? "command-lead",
      ...(options.markdown !== undefined ? { markdown: options.markdown } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.maturityLevel ? { maturityLevel: options.maturityLevel } : {}),
      ...(options.targetPlanRef ? { targetPlanRef: options.targetPlanRef } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.testFaults ? { testFaults: options.testFaults } : {}),
    });
  }

  it("Phase 1 create 成功写入 plan 文件，并自动创建 openplan 根目录和 session 目录", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    const result = await withConfigDir(configDir, async () => createPlan({
      root,
      configDir,
      title: "路由方案设计",
      markdown: "# Plan\n\nhello\n",
      filenameHint: "routing-plan.md",
      generatedBy: "plan-builder",
      planId: "z9y8x7w6",
      maturityLevel: "M2",
      now: new Date("2026-05-18T02:46:12Z"),
    }));

    expect(result.path).toBe(`${sessionKey}/routing-plan.md`);
    expect(result.indexPath).toBe(OPENPLAN_INDEX_FILE);
    expect(result.sessionKey).toBe(sessionKey);
    expect(result.status).toBe("draft");
    expect(result.operation).toBe("create");

    const openplanRoot = path.join(configDir, OPENPLAN_DIR);
    await expect(readFile(path.join(openplanRoot, result.path), "utf8")).resolves.toContain("# Plan");
    expect(await readdir(openplanRoot)).toContain("index.jsonl");
    expect(await readdir(path.join(openplanRoot, sessionKey))).toContain("routing-plan.md");
  });

  it("writePlanArtifact rejects legacy top-level system identity fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(writePlanArtifact({
        projectRoot: root,
        configDir,
        action: "write",
        operation: "create",
        title: "Plan",
        markdown: "# Plan",
        filenameHint: "plan.md",
        generatedBy: "command-lead",
        sessionKey,
        sessionStartedAt,
        planId: "z9y8x7w6",
      } as unknown as Parameters<typeof writePlanArtifact>[0])).rejects.toThrow("PLANART_ERR_LEGACY_SYSTEM_IDENTITY_FORBIDDEN");
    });
  });

  it("cross-session provenance create 成功，且新计划写入当前 session 目录", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      const created = await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
      });

      expect(created.operation).toBe("create");
      expect(created.path).toBe(`${sessionKey}/derived.md`);
      const content = await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8");
      const frontmatter = parseFrontmatter(content);
      expect(frontmatter.source_session_key).toBe(otherSessionKey);
      expect(frontmatter.source_plan_ref).toBe(source.path);
    });
  });

  it("replacement create 成功，并将旧计划状态写为 superseded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      const replacement = await createPlan({
        root,
        configDir,
        title: "New",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
        replacesSessionKey: otherSessionKey,
      });

      const newFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, replacement.path), "utf8"));
      const oldFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, oldPlan.path), "utf8"));
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(replacement.operation).toBe("create");
      expect(newFrontmatter.replaces_session_key).toBe(otherSessionKey);
      expect(newFrontmatter.replaces_plan_ref).toBe(oldPlan.path);
      expect(oldFrontmatter.status).toBe("superseded");
      expect(index).toContain(`"replaces_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"replaces_plan_ref":"${oldPlan.path}"`);
      expect(index).toContain(`"path":"${oldPlan.path}"`);
      expect(index).toContain('"status":"superseded"');
    });
  });

  it("replacement-created plan 在 same-session update 后 replacement 字段仍保留", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      const replacement = await createPlan({
        root,
        configDir,
        title: "New",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
        replacesSessionKey: otherSessionKey,
      });

      await updatePlan({
        root,
        configDir,
        targetPlanRef: replacement.path,
        markdown: "# New\nupdated",
      });

      const frontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, replacement.path), "utf8"));
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(frontmatter.replaces_session_key).toBe(otherSessionKey);
      expect(frontmatter.replaces_plan_ref).toBe(oldPlan.path);
      expect(index).toContain(`"replaces_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"replaces_plan_ref":"${oldPlan.path}"`);
    });
  });

  it("Phase 1 create frontmatter 字段正确", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    const result = await withConfigDir(configDir, async () => createPlan({
      root,
      configDir,
      title: "路由方案设计",
      markdown: "正文",
      filenameHint: "routing-plan.md",
      generatedBy: "plan-builder",
      planId: "a1b2c3d4",
      maturityLevel: "M2",
      now: new Date("2026-05-18T02:46:12Z"),
    }));

    const content = await readFile(path.join(configDir, OPENPLAN_DIR, result.path), "utf8");
    const frontmatter = parseFrontmatter(content);

    expect(frontmatter).toMatchObject({
      plan_id: "a1b2c3d4",
      title: "路由方案设计",
      session_key: sessionKey,
      session_started_at: "2026-05-18T02:30:00.000Z",
      created_at: "2026-05-18T02:46:12.000Z",
      updated_at: "2026-05-18T02:46:12.000Z",
      operation: "create",
      status: "draft",
      generated_by: "plan-builder",
      filename: "routing-plan.md",
      path: `${sessionKey}/routing-plan.md`,
      maturity_level: "M2",
    });
  });

  it("provenance create 时 index 正确写入 provenance 字段", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
        sourceSessionKey: otherSessionKey,
      });

      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");
      expect(index).toContain(`"source_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"source_plan_ref":"${source.path}"`);
    });
  });

  it("普通 create 不触发 superseded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "Unrelated",
        markdown: "# Unrelated",
        filenameHint: "new.md",
        planId: "ccccdddd",
      });

      const oldFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, oldPlan.path), "utf8"));
      expect(oldFrontmatter.status).toBe("draft");
    });
  });

  it("replacement 新计划写失败时旧计划不变", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      await expect(createPlan({
        root,
        configDir,
        title: "New",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
        testFaults: { failPlanWrite: true },
      })).rejects.toThrow(/PLANART_ERR_PLAN_WRITE_FAILED/);

      const oldFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, oldPlan.path), "utf8"));
      expect(oldFrontmatter.status).toBe("draft");
    });
  });

  it("replacement 旧计划 superseded 写失败时 index 不更新", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      const originalIndex = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      await expect(createPlan({
        root,
        configDir,
        title: "New",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
        testFaults: { failReplacementTargetWrite: true },
      })).rejects.toThrow(/replacement target not successfully superseded/);

      await expect(readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8")).resolves.toBe(originalIndex);
      const oldFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, oldPlan.path), "utf8"));
      expect(oldFrontmatter.status).toBe("draft");
    });
  });

  it("replacement target 已是 superseded 时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "First Replacement",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
      });

      await expect(createPlan({
        root,
        configDir,
        title: "Second Replacement",
        markdown: "# New2",
        filenameHint: "new2.md",
        planId: "eeeeffff",
        replacesPlanRef: oldPlan.path,
      })).rejects.toThrow(/already superseded/);
    });
  });

  it("replacement create 可与 provenance 同时存在但语义不混淆", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "ccccdddd",
      });

      const created = await createPlan({
        root,
        configDir,
        title: "Derived Replacement",
        markdown: "# DR",
        filenameHint: "dr.md",
        planId: "eeeeffff",
        sourcePlanRef: source.path,
        sourceSessionKey: otherSessionKey,
        replacesPlanRef: oldPlan.path,
        replacesSessionKey: sessionKey,
      });
      const frontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));

      expect(frontmatter.source_session_key).toBe(otherSessionKey);
      expect(frontmatter.source_plan_ref).toBe(source.path);
      expect(frontmatter.replaces_session_key).toBe(sessionKey);
      expect(frontmatter.replaces_plan_ref).toBe(oldPlan.path);
    });
  });

  it("provenance create 可显式写 reviewed 或 blocked", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      const reviewed = await createPlan({
        root,
        configDir,
        title: "Reviewed Derived",
        markdown: "# Reviewed",
        filenameHint: "reviewed.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
        status: "reviewed",
      });

      const blocked = await createPlan({
        root,
        configDir,
        title: "Blocked Derived",
        markdown: "# Blocked",
        filenameHint: "blocked.md",
        planId: "eeeeffff",
        sourcePlanRef: source.path,
        status: "blocked",
      });

      expect(reviewed.status).toBe("reviewed");
      expect(blocked.status).toBe("blocked");
    });
  });

  it("Phase 1 current-state index 重写成功", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb", now: new Date("2026-05-18T02:46:12Z") });
      await createPlan({ root, configDir, title: "B", markdown: "# B", filenameHint: "b.md", planId: "ccccdddd", now: new Date("2026-05-18T02:47:12Z") });
    });

    const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");
    const lines = index.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.path).toBe(`${sessionKey}/a.md`);
    expect(lines[1]?.path).toBe(`${sessionKey}/b.md`);
    expect(lines[0]?.status).toBe("draft");
  });

  it("Phase 1 create 冲突递增正确", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    const [first, second, third] = await withConfigDir(configDir, async () => {
      const first = await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "foo.bar.md", planId: "aaaabbbb" });
      const second = await createPlan({ root, configDir, title: "B", markdown: "# B", filenameHint: "foo.bar.md", planId: "ccccdddd" });
      const third = await createPlan({ root, configDir, title: "C", markdown: "# C", filenameHint: "foo.bar-v2.md", planId: "eeeeffff" });
      return [first, second, third] as const;
    });

    expect(first.path).toBe(`${sessionKey}/foo.bar.md`);
    expect(second.path).toBe(`${sessionKey}/foo.bar-v2.md`);
    expect(third.path).toBe(`${sessionKey}/foo.bar-v3.md`);
  });

  it("非法文件名被拒绝", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(createPlan({ root, configDir, filenameHint: "../bad.md" })).rejects.toThrow(/filenameHint/);
      await expect(createPlan({ root, configDir, filenameHint: "bad.txt" })).rejects.toThrow(/must end with \.md/);
    });
  });

  it("显式目标 update 成功", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({
        root,
        configDir,
        title: "Plan A",
        markdown: "# A\nold",
        filenameHint: "a.md",
        planId: "aaaabbbb",
        maturityLevel: "M1",
        now: new Date("2026-05-18T02:46:12Z"),
      });

      const updated = await updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# A\nnew",
        title: "Plan A updated",
        maturityLevel: "M2",
        now: new Date("2026-05-18T02:50:00Z"),
      });

      expect(updated.operation).toBe("update");
      expect(updated.path).toBe(created.path);
      expect(updated.status).toBe("draft");

      const content = await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8");
      const frontmatter = parseFrontmatter(content);
      expect(content).toContain("new");
      expect(frontmatter.operation).toBe("update");
      expect(frontmatter.title).toBe("Plan A updated");
      expect(frontmatter.maturity_level).toBe("M2");
    });
  });

  it("默认 update 当前 session 最近计划成功", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "Older", markdown: "# older", filenameHint: "a.md", planId: "aaaabbbb", now: new Date("2026-05-18T02:46:12Z") });
      const latest = await createPlan({ root, configDir, title: "Latest", markdown: "# latest", filenameHint: "b.md", planId: "ccccdddd", now: new Date("2026-05-18T02:47:12Z") });

      const updated = await updatePlan({ root, configDir, markdown: "# latest\nchanged", now: new Date("2026-05-18T02:55:00Z") });

      expect(updated.path).toBe(latest.path);
      await expect(readFile(path.join(configDir, OPENPLAN_DIR, latest.path), "utf8")).resolves.toContain("changed");
      await expect(readFile(path.join(configDir, OPENPLAN_DIR, `${sessionKey}/a.md`), "utf8")).resolves.not.toContain("changed");
    });
  });

  it("当前 session 无候选计划时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(updatePlan({ root, configDir, markdown: "# none" })).rejects.toThrow(/no persisted plan to update/);
    });
  });

  it("显式目标不存在时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(updatePlan({ root, configDir, targetPlanRef: `${sessionKey}/missing.md`, markdown: "# none" })).rejects.toThrow(/target plan does not exist/);
    });
  });

  it("provenance create 在来源计划不存在时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: `${otherSessionKey}/missing.md`,
      })).rejects.toThrow(/target plan does not exist/);
    });
  });

  it("sourcePlanRef 不合法时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: "../bad.md",
      })).rejects.toThrow(/sourcePlanRef/);
    });
  });

  it("sourceSessionKey 单独传入时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourceSessionKey: otherSessionKey,
      })).rejects.toThrow(/sourceSessionKey requires sourcePlanRef/);
    });
  });

  it("显式目标存在但不在当前 session 下时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const other = await createPlan({
        root,
        configDir,
        title: "Other",
        markdown: "# other",
        filenameHint: "other.md",
        planId: "ddddeeee",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      await expect(updatePlan({ root, configDir, targetPlanRef: other.path, markdown: "# denied" })).rejects.toThrow(/current session/);
    });
  });

  it("sourcePlanRef 指向当前 session 时 provenance create 失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({ root, configDir, title: "Same Session", markdown: "# same", filenameHint: "same.md", planId: "aaaabbbb" });

      await expect(createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
      })).rejects.toThrow(/different session/);
    });
  });

  it("sourceSessionKey 与 sourcePlanRef 不一致时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });

      await expect(createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
        sourceSessionKey: "20260518-9999-deadbeef",
      })).rejects.toThrow(/sourceSessionKey does not match/);
    });
  });

  it("session_key 正确但 sessionStartedAt 不匹配时失败", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({
        root,
        configDir,
        title: "Same Session Key",
        markdown: "# same",
        filenameHint: "same.md",
        planId: "aaaabbbb",
      });

      await expect(updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# mismatch",
        sessionStartedAt: "2026-05-18T09:30:00Z",
      })).rejects.toThrow(/PLANART_ERR_SESSION_MISMATCH/);
    });
  });

  it("update 不创建新版本文件，且成功后原 path 不变", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });
      const before = await readdir(path.join(configDir, OPENPLAN_DIR, sessionKey));

      const updated = await updatePlan({ root, configDir, targetPlanRef: created.path, markdown: "# changed" });
      const after = await readdir(path.join(configDir, OPENPLAN_DIR, sessionKey));

      expect(updated.path).toBe(created.path);
      expect(after).toEqual(before);
      expect(after).toContain("same.md");
      expect(after.some((item) => item.includes("-v2"))).toBe(false);
    });
  });

  it("update 成功后 immutable 字段保持不变，mutable 字段正确更新", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({
        root,
        configDir,
        title: "Before",
        markdown: "# before",
        filenameHint: "same.md",
        generatedBy: "plan-builder",
        planId: "aaaabbbb",
        maturityLevel: "M1",
        now: new Date("2026-05-18T02:40:00Z"),
      });
      const before = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));

      await updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# after",
        title: "After",
        maturityLevel: "M2",
        generatedBy: "command-lead",
        now: new Date("2026-05-18T02:50:00Z"),
      });

      const after = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));

      expect(after.plan_id).toBe(before.plan_id);
      expect(after.session_key).toBe(before.session_key);
      expect(after.session_started_at).toBe(before.session_started_at);
      expect(after.created_at).toBe(before.created_at);
      expect(after.generated_by).toBe(before.generated_by);
      expect(after.filename).toBe(before.filename);
      expect(after.path).toBe(before.path);

      expect(after.title).toBe("After");
      expect(after.updated_at).toBe("2026-05-18T02:50:00.000Z");
      expect(after.status).toBe("draft");
      expect(after.operation).toBe("update");
      expect(after.maturity_level).toBe("M2");
    });
  });

  it("derived plan 在 same-session update 后 provenance 仍保留", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      const derived = await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
        sourceSessionKey: otherSessionKey,
      });

      await updatePlan({
        root,
        configDir,
        targetPlanRef: derived.path,
        markdown: "# Derived\nupdated",
      });

      const content = await readFile(path.join(configDir, OPENPLAN_DIR, derived.path), "utf8");
      const frontmatter = parseFrontmatter(content);
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(frontmatter.source_session_key).toBe(otherSessionKey);
      expect(frontmatter.source_plan_ref).toBe(source.path);
      expect(index).toContain(`"source_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"source_plan_ref":"${source.path}"`);
    });
  });

  it("provenance create 不修改来源计划文件或来源计划 index 记录", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      const sourceContent = await readFile(path.join(configDir, OPENPLAN_DIR, source.path), "utf8");
      const sourceIndexBefore = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
      });

      const sourceContentAfter = await readFile(path.join(configDir, OPENPLAN_DIR, source.path), "utf8");
      const sourceIndexAfter = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(sourceContentAfter).toBe(sourceContent);
      expect(sourceIndexAfter).toContain(`"path":"${source.path}"`);
      expect(sourceIndexAfter).toContain(`"plan_id":"aaaabbbb"`);
      expect(sourceIndexAfter).toContain(sourceIndexBefore.split("\n")[0] ?? "");
    });
  });

  it("provenance create 不自动触发 superseded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
      });

      const sourceFrontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, source.path), "utf8"));
      expect(sourceFrontmatter.status).toBe("draft");
    });
  });

  it("内容更新默认状态回到 draft", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });
      await updatePlan({ root, configDir, targetPlanRef: created.path, markdown: "# changed" });
      const frontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));
      expect(frontmatter.status).toBe("draft");
    });
  });

  it("显式 status=reviewed 生效", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });
      const updated = await updatePlan({ root, configDir, targetPlanRef: created.path, status: "reviewed", now: new Date("2026-05-18T02:55:00Z") });
      expect(updated.status).toBe("reviewed");
      const frontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));
      expect(frontmatter.status).toBe("reviewed");
    });
  });

  it("显式 status=blocked 生效", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });
      const updated = await updatePlan({ root, configDir, targetPlanRef: created.path, status: "blocked", now: new Date("2026-05-18T02:55:00Z") });
      expect(updated.status).toBe("blocked");
      const frontmatter = parseFrontmatter(await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8"));
      expect(frontmatter.status).toBe("blocked");
    });
  });

  it("superseded 在本阶段不被引入", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });
      await expect(writePlanArtifact({
        projectRoot: root,
        configDir,
        action: "write",
        operation: "update",
        systemIdentity: { sessionKey, sessionStartedAt },
        generatedBy: "command-lead",
        targetPlanRef: created.path,
        status: "superseded",
      })).rejects.toThrow(/does not support status=superseded|supported statuses/);
    });
  });

  it("update 文件替换失败时原文件不变", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, markdown: "# original", filenameHint: "same.md", planId: "aaaabbbb" });
      const originalContent = await readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8");

      await expect(updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# changed",
        testFaults: { failUpdateReplace: true },
      })).rejects.toThrow(/PLANART_ERR_PLAN_REPLACE_FAILED/);

      await expect(readFile(path.join(configDir, OPENPLAN_DIR, created.path), "utf8")).resolves.toBe(originalContent);
    });
  });

  it("update 文件成功但 index 写失败时自动 rebuild/backfill，成功后整体成功", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    const result = await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, markdown: "# original", filenameHint: "same.md", planId: "aaaabbbb" });
      return updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# changed",
        testFaults: { failIndexWriteOnce: true },
      });
    });

    const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");
    expect(result.rebuildTriggered).toBe(true);
    expect(result.indexStatus).toBe("rebuild_succeeded");
    expect(index).toContain('"operation":"update"');
    expect(index).toContain('"status":"draft"');
  });

  it("rebuild/backfill 失败后整体失败，并返回正确错误语义", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");
    let createdPath = "";

    await withConfigDir(configDir, async () => {
      const created = await createPlan({ root, configDir, markdown: "# original", filenameHint: "same.md", planId: "aaaabbbb" });
      createdPath = created.path;

      await expect(updatePlan({
        root,
        configDir,
        targetPlanRef: created.path,
        markdown: "# changed",
        testFaults: { failIndexWriteOnce: true, failRebuild: true },
      })).rejects.toThrow(/plan file already written|requires follow-up repair/);
    });

    await expect(readFile(path.join(configDir, OPENPLAN_DIR, createdPath), "utf8")).resolves.toContain("# changed");
  });

  it("action=rebuild 成功，并在 openplan 有 plan 文件时正确重建 index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb", now: new Date("2026-05-18T02:46:12Z") });
      await createPlan({ root, configDir, title: "B", markdown: "# B", filenameHint: "b.md", planId: "ccccdddd", now: new Date("2026-05-18T02:47:12Z") });
      await rm(path.join(configDir, OPENPLAN_INDEX_FILE), { force: true });

      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.indexPath).toBe(OPENPLAN_INDEX_FILE);
      expect(rebuilt.scannedFileCount).toBe(2);
      expect(rebuilt.rebuiltRecordCount).toBe(2);
      expect(rebuilt.status).toBe("rebuilt");
      expect(rebuilt.mode).toBe("manual-rebuild");
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/a.md"');
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/b.md"');
    });
  });

  it("action=rebuild 在 openplan 无 plan 文件时行为稳定", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.scannedFileCount).toBe(0);
      expect(rebuilt.rebuiltRecordCount).toBe(0);
      expect(rebuilt.status).toBe("empty");
      expect(index).toBe("");
    });
  });

  it("index 损坏时手动 rebuild 可恢复", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb" });
      await writeFile(path.join(configDir, OPENPLAN_INDEX_FILE), "{broken json\n");

      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.scannedFileCount).toBe(1);
      expect(rebuilt.rebuiltRecordCount).toBe(1);
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/a.md"');
    });
  });

  it("index 为合法 JSONL 但与 plan 文件状态不一致时，rebuild 可恢复", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb", now: new Date("2026-05-18T02:46:12Z") });
      await createPlan({ root, configDir, title: "B", markdown: "# B", filenameHint: "b.md", planId: "ccccdddd", now: new Date("2026-05-18T02:47:12Z") });

      await writeFile(
        path.join(configDir, OPENPLAN_INDEX_FILE),
        `${JSON.stringify({
          plan_id: "aaaabbbb",
          title: "A",
          session_key: sessionKey,
          session_started_at: "2026-05-18T02:30:00.000Z",
          created_at: "2026-05-18T02:46:12.000Z",
          updated_at: "2026-05-18T02:46:12.000Z",
          operation: "create",
          status: "draft",
          generated_by: "command-lead",
          path: `${sessionKey}/a.md`,
          filename: "a.md",
        })}\n`,
      );

      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.rebuiltRecordCount).toBe(2);
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/a.md"');
      expect(index).toContain('"path":"20260518-1030-a1b2c3d4/b.md"');
    });
  });

  it("扫描到非法 frontmatter 文件时 rebuild 失败，且旧 index 不被破坏", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");
    const openplanRoot = path.join(configDir, OPENPLAN_DIR);

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb" });
      const originalIndex = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      await writeFile(path.join(openplanRoot, sessionKey, "bad.md"), "---\nplan_id: broken\n---\nbody\n");

      await expect(rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" })).rejects.toThrow(/invalid plan file/);
      await expect(readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8")).resolves.toBe(originalIndex);
      await expect(readFile(path.join(configDir, OPENPLAN_INDEX_FILE + ".bak"), "utf8")).rejects.toThrow();
    });
  });

  it("扫描到非法 operation frontmatter 时 rebuild 失败，且旧 index 不被破坏", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase3-"));
    const configDir = path.join(root, "config-home");
    const openplanRoot = path.join(configDir, OPENPLAN_DIR);

    await withConfigDir(configDir, async () => {
      await createPlan({ root, configDir, title: "A", markdown: "# A", filenameHint: "a.md", planId: "aaaabbbb" });
      const originalIndex = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      await writeFile(path.join(openplanRoot, sessionKey, "bad-op.md"), [
        "---",
        "plan_id: b1c2d3e4",
        "title: Bad Operation",
        `session_key: ${sessionKey}`,
        "session_started_at: 2026-05-18T02:30:00.000Z",
        "created_at: 2026-05-18T02:46:12.000Z",
        "updated_at: 2026-05-18T02:46:12.000Z",
        "operation: invalid-op",
        "status: draft",
        "generated_by: command-lead",
        "filename: bad-op.md",
        `path: ${sessionKey}/bad-op.md`,
        "---",
        "",
        "# bad",
        "",
      ].join("\n"));

      await expect(rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" })).rejects.toThrow(/invalid plan file|unsupported operation/);
      await expect(readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8")).resolves.toBe(originalIndex);
    });
  });

  it("rebuild/backfill 后 provenance 字段在 index 中仍能正确恢复，且必须同时存在", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase4-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const source = await createPlan({
        root,
        configDir,
        title: "Source",
        markdown: "# Source",
        filenameHint: "source.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "Derived",
        markdown: "# Derived",
        filenameHint: "derived.md",
        planId: "ccccdddd",
        sourcePlanRef: source.path,
        sourceSessionKey: otherSessionKey,
      });
      await rm(path.join(configDir, OPENPLAN_INDEX_FILE), { force: true });

      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.rebuiltRecordCount).toBe(2);
      expect(index).toContain(`"source_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"source_plan_ref":"${source.path}"`);
    });
  });

  it("rebuild/backfill 后 replacement 字段与 superseded 状态仍能正确恢复", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase5-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      const oldPlan = await createPlan({
        root,
        configDir,
        title: "Old",
        markdown: "# Old",
        filenameHint: "old.md",
        planId: "aaaabbbb",
        sessionKey: otherSessionKey,
        sessionStartedAt: otherSessionStartedAt,
      });
      await createPlan({
        root,
        configDir,
        title: "New",
        markdown: "# New",
        filenameHint: "new.md",
        planId: "ccccdddd",
        replacesPlanRef: oldPlan.path,
        replacesSessionKey: otherSessionKey,
      });
      await rm(path.join(configDir, OPENPLAN_INDEX_FILE), { force: true });

      const rebuilt = await rebuildOpenPlanIndex({ configDir, mode: "manual-rebuild" });
      const index = await readFile(path.join(configDir, OPENPLAN_INDEX_FILE), "utf8");

      expect(rebuilt.rebuiltRecordCount).toBe(2);
      expect(index).toContain(`"replaces_session_key":"${otherSessionKey}"`);
      expect(index).toContain(`"replaces_plan_ref":"${oldPlan.path}"`);
      expect(index).toContain(`"path":"${oldPlan.path}"`);
      expect(index).toContain('"status":"superseded"');
    });
  });

  it("negative scope guards: 不支持跨 session update / 非 write action", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openplan-phase2-"));
    const configDir = path.join(root, "config-home");

    await withConfigDir(configDir, async () => {
      await expect(writePlanArtifact({
        projectRoot: root,
        configDir,
        // @ts-expect-error negative guard
        action: "update",
        operation: "update",
        systemIdentity: { sessionKey, sessionStartedAt },
        generatedBy: "command-lead",
        markdown: "# A",
      })).rejects.toThrow(/action must be write/);

      await expect(writePlanArtifact({
        projectRoot: root,
        configDir,
        action: "write",
        operation: "create",
        title: "Legacy identity",
        markdown: "# x",
        sessionKey,
        sessionStartedAt,
        filenameHint: "legacy.md",
        generatedBy: "command-lead",
      } as unknown as Parameters<typeof writePlanArtifact>[0])).rejects.toThrow(/LEGACY_SYSTEM_IDENTITY_FORBIDDEN/);

      await createPlan({ root, configDir, filenameHint: "same.md", planId: "aaaabbbb" });

      await expect(updatePlan({
        root,
        configDir,
        targetPlanRef: `${otherSessionKey}/other.md`,
        markdown: "# no",
      })).rejects.toThrow(/current session/);
    });
  });

  it("保留 slug fallback 行为供其他调用方复用", () => {
    expect(sanitizeSlug("修复 模型导入!")).toBe("plan");
    expect(sanitizeSlug("Agent Models Import Fix")).toBe("agent-models-import-fix");
  });
});
