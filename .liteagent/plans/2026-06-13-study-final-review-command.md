---
plan_schema_version: 2.1
plan_id: study-final-review-command-20260613
title: Add /study final exam review workflow command
maturity_level: M2
status: draft
repo_snapshot_ref: a874b7e
generated_by: plan_builder
updated_at: 2026-06-13T04:04:53Z
recommended_plan_path: .liteagent/plans/2026-06-13-study-final-review-command.md
---

## goals

- 新增受管 `/study` 命令，让 `command-lead` 编排期末复习资料生成流程。
- 支持从 `.ppt`、`.pptx`、`.pdf` 课件提取内容，按章节归纳考点、重点、易混点和刷题资料。
- 直接在当前课件目录生成可长期复用的复习项目，包括根目录 `AGENTS.md`、导览、思维导图源文件、Anki 卡片和模拟题。

## scope_boundaries

in:
- 在 `scripts/managed-config.mjs` 注册 `/study`，目标 agent 仍为 `command-lead`。
- 在 `scripts/install.mjs` 的受管命令集合中纳入 `study`，保留用户自定义配置合并语义。
- 增加课件导入能力，输出标准化 slide/chapter JSON 或 Markdown 中间件供 agent 分析。
- 扩展 `command-lead.md` 的 Study Protocol，定义当前目录课件发现、分章派工、复核、根目录复习项目生成与安全边界。
- 为每个复习项目生成或更新根目录 `AGENTS.md`，作为后续 AI 读取和维护该课件目录的规范入口。
- 更新测试与中英文 README，覆盖命令注册、架构不变式、课件导入降级和输出产物。

out:
- 不新增第四个可见 mode，不新增真实角色，不新增路由类别。
- 不把 NotebookLM 做成 UI 产品；第一版只生成可打开/可导入的文件产物。
- 不递归扫描子目录；第一版只处理当前目录第一层的 `.ppt/.pptx/.pdf`。
- 不默认写入当前课件目录之外的位置，不写入 `.opencode/` 或 `.liteagent/` 作为复习输出目录。
- 不把外部资料当作课件原始来源；外部补充默认允许但必须标记为 `[External]`。
- 不保证识别手写、扫描图片或复杂动画中的全部文字；低文本页需要导出快照并标记为需要视觉复核。

## assumptions

- [User Confirmed] 第一阶段先写计划；后续实现目标包含 `.ppt/.pptx/.pdf` 全格式输入、文件复习包、导览/思维导图和刷题卡片。
- [Repo Observed] 现有受管命令定义集中在 `scripts/managed-config.mjs`，命令通过 `agent: "command-lead"` 进入总控。
- [Repo Observed] 仓库架构固定为三个可见模式、八个真实角色和一层子编排；`/study` 必须是 command/workflow，不是新 mode 或新 agent。
- [User Confirmed] `/study` 默认直接在当前课件目录生成复习项目文件，只扫描当前目录，外部补充默认允许但全部标记 `[External]`。
- [Inferred] `.ppt` 旧二进制格式采用 `soffice`/LibreOffice 转换降级路径；依据是 Node 侧直接解析旧 `.ppt` 风险高，而用户要求全格式支持。

## decisions

- `/study` 采用受管 slash command：模板接收 `$ARGUMENTS`，由 `command-lead` 解析课程名、考试范围和当前课件目录上下文。
- 课件发现默认只扫描当前目录第一层 `.ppt/.pptx/.pdf`；生成的 `.md/.json/.csv` 和 `sources/`、`summaries/`、`reviews/`、`repairs/` 不作为输入再次处理。
- 课件导入采用“课程资料优先”策略：课件内容是 canonical source，`librarian` 默认可补充解释，但所有非课件内容必须标记 `[External]`。
- 输出默认直接落在当前课件目录根部，包含 `AGENTS.md`、`source-index.json`、`study-guide.md`、`exam-points.md`、`mindmap.md`、`anki_flashcards.csv`、`practice-questions.md`、`coverage-report.md`、`sources/`、`summaries/`、`reviews/`、`repairs/`。
- 若当前目录已有 `AGENTS.md`，只创建或更新 `<!-- oh-my-lite-study:start -->` 到 `<!-- oh-my-lite-study:end -->` 之间的受管区块；无 marker 时追加新区块；marker 缺失、重复、顺序颠倒或嵌套时返回可恢复 blocker，不覆盖非受管内容。
- `result-review` 不直接审查 Task Lead child return；`command-lead` 必须先把最多三个 Task Lead 结果整合成 Command Lead-owned batch summary，再交给 `result-review`，最终复核也审查 Command Lead-owned final integrated result。
- 解析工具优先走轻量 Node 实现；`.ppt` 通过 LibreOffice 转换到可解析格式，缺少转换工具时返回可恢复 blocker，而不是静默跳过。
- 对文本稀疏或图表密集页，生成 slide snapshot/low-text 标记，并派发带 `multimodal`/`visual` 属性的复核任务。

## phase_plan

1. 命令与安装器：注册 `/study`，同步受管命令集合和命令模板测试。
2. 课件导入：实现标准化 ingest 工具/模块，只发现当前目录 `.ppt/.pptx/.pdf`，提取文本、页码、标题、章节线索和低文本页标记。
3. 编排协议：在 `command-lead` 中加入 Study Protocol，定义 Task Lead 按课件/切片并发、每三份结果整合为 Command Lead-owned batch summary 后 review、修复循环、最终整体 review 和输出包规范。
4. 产物生成：生成根目录 `AGENTS.md`、忠实原文 Markdown、重点摘要、总复习包、思维导图源文件、Anki CSV 和练习题。
5. 测试与文档：覆盖命令注册、架构不变式、导入降级、输出 schema 与 README 示例。

## acceptance_criteria

- `scripts/managed-config.mjs` 注册 `command.study`，`agent` 为 `command-lead`，模板包含 `$ARGUMENTS`、当前工作目录课件输入、当前目录复习项目输出和安全边界。
- `scripts/install.mjs` 将 `study` 作为受管命令合并；不会删除用户 provider、model、API key、无关插件或自定义 agent。
- 新增 `bounded_lite_study_ingest` 或等价 provider-safe 工具，工具名以 `bounded_lite_` 开头，并能返回当前目录结构化来源索引、章节候选和低文本页报告。
- `.pptx` 与 `.pdf` 至少有自动化 fixture 测试；`.ppt` 在 LibreOffice 可用时通过转换测试，不可用时返回明确可恢复 blocker。
- `/study` 在 OpenCode 当前工作目录作为课件目录生成默认复习项目文件；默认不递归，不读取子目录课件，不把生成物重新 ingest，不写入 `.opencode/` 或 `.liteagent/`。
- 若当前目录已有 `AGENTS.md`，正常 marker 存在时只替换受管区块；无 marker 时追加新区块；marker 缺失、重复、顺序颠倒或嵌套时返回可恢复 blocker，不覆盖非受管内容。
- 每个课件或切片的 `task-lead` 结果至少包含 `sources/<deck>.md` 和 `summaries/<deck>.md`，前者忠实保留原始内容，后者面向期末复习总结。
- `command-lead` 将最多三个 `task-lead` 结果整合为 Command Lead-owned batch summary 后交给 Result Review 并行审查；全部 batch 通过后，再对 Command Lead-owned final integrated result 执行一次最终审查。
- 复习项目包含 Anki CSV、思维导图、章节摘要、考点清单和覆盖报告，且可由测试或快照检查验证。
- Study Protocol 不改变 `VISIBLE_MODES`、`ROLE_CONTRACTS`、`ROUTING_CATEGORIES` 或 `MAX_CHILD_ORCHESTRATOR_DEPTH`。
- 验证命令通过：`npm test`、`npm run typecheck`、`node scripts/install.mjs --dry-run`。

## risks

- 风险：课件解析依赖可能增加安装体积或跨平台问题。缓解：将依赖限定在导入模块，提供清晰降级和缺失工具提示。
- 风险：`.ppt` 或图片型课件无法稳定提取文本。缓解：优先转换，检测低文本页，生成视觉复核任务和人工检查清单。
- 风险：复习资料可能混入外部知识导致偏离老师课件。缓解：课件来源优先，外部补充显式标记，不纳入核心考点除非用户允许。
- 风险：输出包过大导致一次性上下文拥塞。缓解：先生成 `source-index.json` 和章节切片，再按章节并发派工，最后汇总复核。
- 风险：在用户课件目录根部生成 `AGENTS.md` 可能覆盖已有规范。缓解：使用明确受管区块更新，保留非受管内容。

## evidence

- `scripts/managed-config.mjs`: 当前 `agent-models` 与 `go` 命令在 `MANAGED_CONFIG.command` 下注册，并指向 `command-lead`。
- `scripts/install.mjs`: 安装器通过 `MANAGED_COMMAND_NAMES` 控制受管命令合并边界。
- `.opencode/agents/command-lead.md`: `command-lead` 已包含 Go Protocol、计划 readiness gate、子任务委派合同和结果复核规则。
- `.opencode/plugins/bounded-lite.ts`: 自定义工具集中注册在 plugin `tool` 区块，现有工具均使用 `bounded_lite_` 前缀。
- `.opencode/lib/contracts.ts`: 现有架构约束固定可见模式、真实角色、路由类别和子编排深度。
- `tests/config/agents.test.ts` 与 `tests/integration/conformance.test.ts`: 测试会锁定命令注册、可见模式、隐藏角色和架构不变式。

## plan

```yaml
plan:
  subtasks:
    - id: register-study-command
      depends_on: []
      attributes: [code]
      deliverable: `scripts/managed-config.mjs` and `scripts/install.mjs` register `/study` as a managed `command-lead` command.
      description: Add the command template and managed-command merge entry without changing modes, roles, routing categories, providers, or user-local config preservation.
    - id: implement-study-ingest
      depends_on: [register-study-command]
      attributes: [code, research]
      deliverable: A provider-safe `bounded_lite_study_ingest` tool or equivalent runtime module that normalizes current-directory `.ppt`, `.pptx`, and `.pdf` sources into chapter/slide data.
      description: Discover only first-level courseware files, extract text and metadata, handle `.ppt` conversion via LibreOffice when available, ignore generated study outputs, report low-text pages, and return recoverable blockers for missing conversion tools.
    - id: add-study-protocol
      depends_on: [register-study-command, implement-study-ingest]
      attributes: [writing, code]
      deliverable: `.opencode/agents/command-lead.md` documents Study Protocol for `/study` orchestration.
      description: Define input interpretation, source-first policy, Task Lead per-deck or per-slice dispatch, Librarian `[External]` rules, Command Lead-owned batch summaries for review, repair routing, final integrated-result review, and visual fallback.
    - id: generate-study-package
      depends_on: [implement-study-ingest, add-study-protocol]
      attributes: [code, writing, multimodal]
      deliverable: `/study` can produce root-level `AGENTS.md`, `source-index.json`, `study-guide.md`, `exam-points.md`, `mindmap.md`, `anki_flashcards.csv`, `practice-questions.md`, `coverage-report.md`, `sources/`, `summaries/`, `reviews/`, and `repairs/` in the current courseware directory.
      description: Implement or document the bounded workflow that turns normalized courseware into a current-directory study project while preserving source references for each chapter and exam point.
    - id: test-study-workflow
      depends_on: [generate-study-package]
      attributes: [code]
      deliverable: Tests cover `/study` command registration, architecture invariants, current-directory ingest behavior, non-recursive scan, generated-output ignore rules, `AGENTS.md` managed-block safety, degraded `.ppt` handling, and output package shape.
      description: Update relevant config, runtime, integration, fixture, and snapshot tests without loosening existing permission/order/role invariants.
    - id: document-study-command
      depends_on: [add-study-protocol, generate-study-package]
      attributes: [docs, writing]
      deliverable: `README.md` and `README.zh-CN.md` document `/study` usage, supported inputs, current-directory outputs, root `AGENTS.md`, optional LibreOffice requirement, and external-source labeling.
      description: Add concise examples such as running `/study --subject "数据库" --exam "闭卷期末"` from a courseware directory and clarify this is a command workflow, not a new OpenCode mode.
    - id: verify-study-command
      depends_on: [test-study-workflow, document-study-command]
      attributes: [quick]
      deliverable: Verification results for `npm test`, `npm run typecheck`, and `node scripts/install.mjs --dry-run`.
      description: Run required checks, fix in-scope failures, and report any environment-only limitations such as missing LibreOffice for legacy `.ppt` conversion.
```
