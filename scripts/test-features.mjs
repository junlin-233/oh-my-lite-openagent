#!/usr/bin/env node
/**
 * 本地功能验证脚本 — 无需 OpenCode 即可测试三个新增功能
 *
 * 用法：
 *   node scripts/test-features.mjs
 *
 * 然后跑完整单元测试：
 *   npm test
 *
 * 测试内容：
 *   1. 角色模型推荐引擎 (resolveAutoModels 核心逻辑)
 *   2. 安装器脚本结构验证
 *   3. opencode.json 和插件完整性
 *   4. install.mjs --dry-run
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ============================================================================
// 工具
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${message}`);
  }
}

function section(title) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(70)}`);
}

// ============================================================================
// 1. 角色模型推荐引擎（内联核心逻辑验证）
// ============================================================================

function testRoleModelRecommendations() {
  section("1. 角色模型推荐引擎 (核心逻辑)");

  // 复制推荐数据的核心结构（与 role-model-recommendations.ts 保持一致）
  const ROLE_MODEL_PROFILES = [
    { role: "command-lead", capability: "orchestration", recommendations: ["claude-opus","gpt-5.4","gemini-2.5-pro","claude-sonnet","kimi-k2","gpt-4o","glm-5","minimax-m2"] },
    { role: "plan-builder", capability: "planning", recommendations: ["claude-opus","gpt-5.4","gemini-2.5-pro","claude-sonnet","kimi-k2","gpt-4o","glm-5","minimax-m2"] },
    { role: "deep-plan-builder", capability: "advisory-planning", recommendations: ["claude-sonnet","kimi-k2","gpt-5.4","claude-opus","gpt-4o","gemini-2.5-flash","glm-5","minimax-m2"] },
    { role: "task-lead", capability: "execution", recommendations: ["claude-sonnet","kimi-k2","gpt-5.4","gemini-2.5-pro","gpt-4o","minimax-m2","gpt-5-nano"] },
    { role: "explore", capability: "fast-retrieval", recommendations: ["gpt-5.4-mini","claude-haiku","minimax-m2.7-highspeed","minimax-m2","gemini-2.0-flash","gpt-5-nano"] },
    { role: "librarian", capability: "fast-retrieval", recommendations: ["gpt-5.4-mini","claude-haiku","minimax-m2.7-highspeed","minimax-m2","gemini-2.0-flash","gpt-5-nano"] },
    { role: "plan-review", capability: "critical-review", recommendations: ["gpt-5.4","claude-opus","gemini-2.5-pro","claude-sonnet","gpt-4o","glm-5","minimax-m2"] },
    { role: "result-review", capability: "critical-review", recommendations: ["gpt-5.4","claude-opus","gemini-2.5-pro","claude-sonnet","gpt-4o","glm-5","minimax-m2"] },
  ];

  const ROLE_CAPABILITY_DESCRIPTIONS = {
    orchestration: "Needs strongest reasoning model",
    planning: "Needs strong reasoning and structured output",
    "advisory-planning": "Can use weaker models with mandatory review",
    execution: "Can use mid-tier models",
    "fast-retrieval": "Should use fast, cheap models",
    "critical-review": "Needs strongest reasoning to catch errors",
  };

  function matchesPattern(modelId, pattern) {
    return modelId.toLowerCase().includes(pattern.toLowerCase());
  }

  function resolveAutoModels(availableModels) {
    const assignments = {};
    const resolved = [];
    const unresolved = [];

    for (const profile of ROLE_MODEL_PROFILES) {
      let bestModel = undefined;
      let matchedPattern = undefined;

      for (const pattern of profile.recommendations) {
        const matched = availableModels.find((m) => matchesPattern(m.id, pattern));
        if (matched) {
          bestModel = matched.id;
          matchedPattern = pattern;
          break;
        }
      }

      if (bestModel) {
        assignments[profile.role] = bestModel;
        resolved.push({ role: profile.role, model: bestModel, matchedPattern });
      } else {
        unresolved.push({ role: profile.role, capability: profile.capability });
      }
    }

    return { assignments, resolved, unresolved };
  }

  // 1.1 覆盖率检查
  assert(ROLE_MODEL_PROFILES.length === 8, "8 个角色都有推荐配置");
  const capabilities = new Set(ROLE_MODEL_PROFILES.map((p) => p.capability));
  for (const cap of capabilities) {
    assert(ROLE_CAPABILITY_DESCRIPTIONS[cap], `能力 ${cap} 有描述`);
  }

  // 1.2 全模型可用
  const fullModels = [
    { id: "anthropic/claude-opus-4-7" },
    { id: "anthropic/claude-sonnet-4-6" },
    { id: "anthropic/claude-haiku-4-5" },
    { id: "openai/gpt-5.4" },
    { id: "openai/gpt-5.4-mini" },
    { id: "google/gemini-2.5-pro" },
  ];
  const fullResult = resolveAutoModels(fullModels);
  assert(fullResult.resolved.length === 8, "全模型 → 8 个角色全部分配");
  assert(fullResult.unresolved.length === 0, "全模型 → 0 个未解决");
  assert(fullResult.assignments["command-lead"] === "anthropic/claude-opus-4-7", "command-lead → Claude Opus");
  assert(fullResult.assignments["explore"] === "openai/gpt-5.4-mini", "explore → GPT-5.4-mini");
  assert(fullResult.assignments["librarian"] === "openai/gpt-5.4-mini", "librarian → GPT-5.4-mini");

  // 1.3 单 provider
  const openaiOnly = [{ id: "openai/gpt-5.4" }];
  const openaiResult = resolveAutoModels(openaiOnly);
  assert(openaiResult.resolved.length >= 1, "单 provider → 至少 1 个角色");
  assert(openaiResult.assignments["command-lead"] === "openai/gpt-5.4", "command-lead → GPT-5.4");
  assert(openaiResult.assignments["plan-review"] === "openai/gpt-5.4", "plan-review → GPT-5.4");

  // 1.4 空列表
  const emptyResult = resolveAutoModels([]);
  assert(emptyResult.resolved.length === 0, "空列表 → 0 个角色");
  assert(emptyResult.unresolved.length === 8, "空列表 → 8 个未解决");

  // 1.5 大小写不敏感
  const upperResult = resolveAutoModels([{ id: "Anthropic/Claude-Opus-4-7" }]);
  assert(upperResult.resolved.length >= 1, "大小写不敏感匹配正常");

  // 1.6 跨 provider 匹配
  const crossResult = resolveAutoModels([{ id: "opencode/claude-opus-4-7" }]);
  assert(crossResult.assignments["command-lead"] === "opencode/claude-opus-4-7", "跨 provider 匹配正常");

  // 1.7 OpenCode Go 场景
  const opencodeGoOnly = [
    { id: "opencode-go/kimi-k2.5" },
    { id: "opencode-go/minimax-m2.7" },
    { id: "opencode-go/glm-5" },
  ];
  const goResult = resolveAutoModels(opencodeGoOnly);
  assert(goResult.resolved.length >= 4, "OpenCode Go → 至少 4 个角色分配");
  assert(goResult.assignments["task-lead"]?.includes("kimi-k2.5"), "task-lead 用 Kimi K2.5");

  // 1.8 快速角色应选快速模型
  const fastModels = [{ id: "openai/gpt-5.4-mini" }, { id: "anthropic/claude-haiku-4-5" }];
  const fastResult = resolveAutoModels(fastModels);
  assert(fastResult.assignments["explore"] === "openai/gpt-5.4-mini", "explore 优先选 gpt-5.4-mini");
  assert(fastResult.assignments["librarian"] === "openai/gpt-5.4-mini", "librarian 优先选 gpt-5.4-mini");
}

// ============================================================================
// 2. 安装器脚本结构验证
// ============================================================================

function testInstallerStructure() {
  section("2. 安装器脚本结构验证");

  const installSource = readFileSync(path.join(ROOT, "scripts", "install.mjs"), "utf8");

  // 2.1 Provider 问题
  assert(installSource.includes("hasClaude"), "包含 hasClaude 问题");
  assert(installSource.includes("hasOpenAI"), "包含 hasOpenAI 问题");
  assert(installSource.includes("hasGemini"), "包含 hasGemini 问题");
  assert(installSource.includes("hasCopilot"), "包含 hasCopilot 问题");
  assert(installSource.includes("hasOpenCodeZen"), "包含 hasOpenCodeZen 问题");
  assert(installSource.includes("hasOpenCodeGo"), "包含 hasOpenCodeGo 问题");
  assert(installSource.includes("hasKimiCoding"), "包含 hasKimiCoding 问题");
  assert(installSource.includes("hasVercelGateway"), "包含 hasVercelGateway 问题");

  // 2.2 交互功能
  assert(installSource.includes("--interactive"), "支持 --interactive 参数");
  assert(installSource.includes("promptProviders"), "包含交互提示函数");
  assert(installSource.includes("resolveModelsForProviders"), "包含模型解析函数");
  assert(installSource.includes("applyModelAssignments"), "包含模型写入函数");
  assert(installSource.includes("collectModelsFromProviders"), "包含 provider 模型收集函数");
  assert(installSource.includes("ROLE_MODEL_PROFILES"), "包含角色模型推荐数据");

  // 2.3 推荐角色表在安装器中完整
  for (const role of ["command-lead", "plan-builder", "deep-plan-builder", "task-lead", "explore", "librarian", "plan-review", "result-review"]) {
    assert(installSource.includes(`"${role}"`), `安装器包含角色 ${role}`);
  }
}

// ============================================================================
// 3. opencode.json 和插件完整性
// ============================================================================

function testConfigIntegrity() {
  section("3. opencode.json 和插件完整性");

  const config = JSON.parse(readFileSync(path.join(ROOT, "opencode.json"), "utf8"));

  // 3.1 命令注册
  assert(config.command && config.command["Character-model"], "/Character-model 命令已注册");
  const template = config.command["Character-model"].template;
  assert(template.includes("action=auto"), "命令模板提及 auto 模式");
  assert(template.includes("action=list"), "命令模板提及 list 模式");
  assert(template.includes("action=apply"), "命令模板提及 apply 模式");
  assert(template.includes("bounded_lite_model_config"), "命令模板提及工具名");

  // 3.2 角色表覆盖
  const agentNames = Object.keys(config.agent);
  assert(agentNames.length === 10, "10 个 agent（8 角色 + 2 禁用覆盖）");

  // 3.3 推荐数据文件
  const tsContent = readFileSync(
    path.join(ROOT, ".opencode", "lib", "runtime", "role-model-recommendations.ts"),
    "utf8",
  );
  assert(tsContent.includes("ROLE_MODEL_PROFILES"), "推荐文件包含 ROLE_MODEL_PROFILES");
  assert(tsContent.includes("resolveAutoModels"), "推荐文件包含 resolveAutoModels");
  assert(tsContent.includes("formatAutoModelReport"), "推荐文件包含 formatAutoModelReport");
  assert(tsContent.includes("getAllRecommendedPatterns"), "推荐文件包含 getAllRecommendedPatterns");
  assert(tsContent.includes("validateProfileCoverage"), "推荐文件包含 validateProfileCoverage");
  assert(tsContent.includes("orchestration"), "推荐文件包含 orchestration 能力");
  assert(tsContent.includes("fast-retrieval"), "推荐文件包含 fast-retrieval 能力");
  assert(tsContent.includes("critical-review"), "推荐文件包含 critical-review 能力");

  // 3.4 插件文件
  const pluginContent = readFileSync(
    path.join(ROOT, ".opencode", "plugins", "bounded-lite.ts"),
    "utf8",
  );
  assert(pluginContent.includes('action === "auto"'), "插件支持 auto action");
  assert(pluginContent.includes('action === "list"'), "插件支持 list action");
  assert(pluginContent.includes('action === "apply"'), "插件支持 apply action");
  assert(pluginContent.includes("resolveAutoModels"), "插件导入 resolveAutoModels");
  assert(pluginContent.includes("formatAutoModelReport"), "插件导入 formatAutoModelReport");
  assert(pluginContent.includes("auto-configure"), "工具描述包含 auto-configure");
}

// ============================================================================
// 4. install.mjs --dry-run
// ============================================================================

async function testInstallerDryRun() {
  section("4. install.mjs --dry-run");

  const { install } = await import(pathToFileURL(path.join(ROOT, "scripts", "install.mjs")).href);
  const result = await install({ dryRun: true, rootDir: ROOT });

  assert(result.dryRun === true, "dryRun 标志正确");
  assert(result.configPath.includes("opencode.json"), "配置路径包含 opencode.json");
  assert(result.plugin.includes("bounded-lite.ts"), "插件路径包含 bounded-lite.ts");
}

// ============================================================================
// 5. vitest 测试提醒
// ============================================================================

function testReminder() {
  section("5. 完整单元测试提醒");

  console.log("\n  要跑完整单元测试（含 TypeScript 编译验证），请执行：");
  console.log("    npm test");
  console.log("\n  vitest 包含 20 个新增的 role-model-recommendations 测试");
  console.log("  以及原有的 model-config / config / integration 测试。");
  console.log("\n  要验证安装交互式模型配置，请执行：");
  console.log("    node scripts/install.mjs --interactive --dry-run");
  console.log("\n  要验证 /character model auto，请在 OpenCode 中执行：");
  console.log("    /character model");
  console.log("    然后选择 action=auto");
}

// ============================================================================
// 运行所有测试
// ============================================================================

async function main() {
  console.log("\n🔧 Oh My Lite OpenAgent — 本地功能验证\n");

  try {
    testRoleModelRecommendations();
    testInstallerStructure();
    testConfigIntegrity();
    await testInstallerDryRun();
    testReminder();
  } catch (err) {
    console.error("\n💥 测试执行错误:", err);
    failed += 1;
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  结果：${passed} 通过 / ${failed} 失败`);
  console.log(`${"=".repeat(70)}\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();