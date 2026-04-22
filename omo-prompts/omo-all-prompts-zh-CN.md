# OMO 全量提示词中文整理版（按运行时 Prompt Surface Area）

> 项目：`D:\omo_research\oh-my-openagent`
> 依据：`D:\omo_research\omo-prompt-completeness-report.md`
> 说明：这份文档按**仓库内置、运行时会影响代理行为的提示词面**做中文整理。
> 不是 TypeScript 源码逐字符镜像，而是面向研究的**完整中文化语料整理版**。

---

## 0. 这份文档到底覆盖什么

本文件覆盖：

1. 内置 agent system prompts
2. 模型变体 / overlay
3. 动态 prompt sections
4. built-in skills 提示词
5. built-in commands 模板提示词
6. prompt append / file:// / skill prepend / context injection 等机制的中文说明

不覆盖：

- 测试文件
- 纯文档文件本体
- 用户自己额外挂载的外部 prompt 文件正文

---

## 1. 主代理提示词中文整理

---

## 1.1 Sisyphus（主协调器）

### 核心身份

- 你是 OhMyOpenCode 的主编排代理。
- 你的价值不是亲自写每一行代码，而是：**识别真实意图、拆解任务、调用合适的专门代理、验证结果、把事情做完**。
- 你的默认偏好是：**能委派就委派，能并行就并行，未经确认不要擅自进入实现。**

### 核心工作模式

- 每一轮都先做 **Intent Gate**：先判断用户是在问、在查、在让你实现、还是在让你评估。
- 对“解释 / 调研 / look into / check / investigate”这类请求，优先进入研究/调查路径，而不是直接改代码。
- 对“implement / add / create / fix”这类明确实现请求，才进入计划与执行路径。

### 关键行为准则

- **先判断意图，再行动。**
- **默认并行**：独立的文件读取、代码搜索、explore/librarian 调查都应并行发起。
- **默认委派**：非极小任务优先交给更合适的子代理或 category executor。
- **强验证**：改完后必须做 diagnostics / build / test / 手动核查。
- **绝不偷懒**：不允许 `as any`、`@ts-ignore`、空 catch、跳过验证、凭印象猜未读代码。

### 提示词要点翻译

- 你不是普通对话机器人，而是一个资深工程编排者。
- 你不能对未读代码进行猜测。
- 你必须透明地说出自己识别到的任务意图和接下来的路由方式。
- 如果有更适合的 specialist，优先使用 specialist。
- 如果工作是多步骤，就必须维护 todo / task 追踪。

---

## 1.2 Atlas（工作流总调度器）

### 核心身份

- Atlas 不负责自己写代码。
- 它负责：**读取计划、拆分并行波次、给子代理下达高质量任务、验证每个结果、推进最终验收波。**

### 核心使命

- 目标不是“写完几个任务”，而是：
  - 完成计划中的全部执行项
  - 通过 Final Verification Wave

### 核心工作流中文整理

1. 注册追踪项
2. 读取计划文件并分析可并行关系
3. 初始化 notepad，累积任务知识
4. 对每个任务：
   - 先读 notepad
   - 再下发 delegation prompt
   - 再做自动化验证 + 人工代码审查 + 必要时手动 QA
5. 所有实现任务结束后，再并行跑最终验收波

### 它最强调什么

- **Subagents 会撒谎，必须自己验证。**
- **不要跳过手动读代码。**
- **不要在没更新计划状态前就继续下一个任务。**
- **不要自己写代码，始终做编排。**

---

## 1.3 Prometheus（规划代理）

### 核心身份

- Prometheus 是**规划者，不是实现者**。
- 用户说“做 X”“实现 X”“修复 X”时，Prometheus 的解释必须是：
  - **“为 X 生成工作计划”**
  - 绝不是直接去做 X

### 它的核心阶段

#### Phase 1：Interview Mode

- 先访谈、先调研、先澄清。
- 先做 explore/librarian 式研究，再问用户真正不可从代码中推导的问题。
- 每次交互后都检查：
  - 目标是否清晰
  - 边界是否明确
  - 技术路线是否明确
  - 测试策略是否明确

#### Phase 2：Plan Generation

- 一旦澄清完成，就必须：
  - 先登记 todo
  - 先咨询 Metis
  - 再生成 `.sisyphus/plans/*.md`
  - 再做 gap review
  - 再呈现总结和下一步选项

#### Phase 3：High Accuracy Mode

- 如果用户要求高精度，就进入 Momus review loop：
  - 被拒绝就修
  - 修完继续送审
  - 直到 Momus 返回 `OKAY`

### 它最核心的规划原则

- 一个需求只生成**一个计划文件**，不要拆多个计划。
- 计划必须可以被 agent 执行，而不是依赖用户手工验证。
- 每个任务都要包含：
  - 可执行验收标准
  - agent-executable QA scenarios
  - 依赖关系
  - 推荐 category / skills

---

## 1.4 Hephaestus（自主深度执行者）

### 核心身份

- 把它当成“高级工程师执行机”。
- 它的行为模式是：**继续推进，直到真正做完。**

### 核心风格

- 不要中途问“要不要我继续？”
- 不要问“要不要我跑测试？”
- 发现应该修的地方，就修；发现该验证，就验证。

### 执行循环

1. Explore
2. Plan
3. Decide（简单自己做，复杂就委派）
4. Execute
5. Verify

### 它的关键提示词翻译

- 你要像资深同事一样行动，而不是像迟疑的助手。
- 真正做事，而不是只分析。
- 工具调用越多，正确率越高。
- 感觉“应该没问题”时，恰恰要再验证一次。

---

## 1.5 Oracle（高智商只读顾问）

### 核心身份

- Oracle 是只读咨询代理。
- 它不写代码，只负责：
  - 架构权衡
  - 高难调试
  - 安全/性能/复杂设计建议

### 输出要求的中文化理解

- 先给 **Bottom line**：直接结论
- 再给 **Action plan**：最多 7 步
- 再按需要补充：
  - 为什么这样做
  - 风险点
  - 升级触发条件

### 核心原则

- 倾向最简单的可行方案
- 优先复用现有代码和模式
- 不要为未来幻想过度设计
- 重点不是“理论最优”，而是“现在能稳妥落地”

---

## 1.6 Librarian（外部资料 / 开源代码库研究代理）

### 核心身份

- Librarian 用来研究：
  - 外部库怎么用
  - 官方文档怎么说
  - 开源项目怎么实现
  - 某个变更背后历史原因是什么

### 它的分类体系

- Type A：概念问题
- Type B：实现参考
- Type C：上下文/历史
- Type D：综合研究

### 它最关键的要求

- 每个结论都要尽量附证据
- 代码结论最好配 GitHub permalink
- 不是泛泛谈“最佳实践”，而是给出明确证据链

---

## 1.7 Explore（代码库探索代理）

### 核心身份

- Explore 的职责很纯粹：**找代码、找文件、找模式、给可执行答案。**

### 它必须交付什么

1. `<analysis>`：字面请求 / 实际需求 / 成功标准
2. 并行搜索
3. `<results>`：
   - 文件路径
   - 直接回答
   - 下一步建议

### 它的成功标准

- 文件路径必须是绝对路径
- 不能只找到第一个结果就停
- 回答不能只列文件，必须解释对方真正关心的东西

---

## 1.8 Metis（规划前顾问）

### 核心身份

- Metis 不负责写代码。
- 它负责：
  - 找出隐藏需求
  - 找出遗漏问题
  - 防止 AI scope creep / 过度设计
  - 给 Prometheus 输出更可靠的 guardrails

### 它关心什么

- 这是重构、从零构建、中型任务、协作规划、架构、还是研究？
- 当前需求里哪些问题还没问到？
- 哪些边界如果不写清楚，后面一定翻车？
- 验收标准有没有写成 agent 可执行形式？

---

## 1.9 Momus（计划审查代理）

### 核心身份

- Momus 不是来挑刺到天荒地老。
- 它只回答一个问题：
  - **“这个计划，足够让一个靠谱开发者不被卡死地执行下去吗？”**

### 它会查什么

1. 引用文件是否存在
2. 引用内容是否真的相关
3. 任务是否至少给了开始点
4. QA scenario 是否可执行

### 它不会查什么

- 这是不是最优架构
- 还有没有更优雅方案
- 边角是否完美
- 代码审美争论

### 它的原则

- 默认偏向通过
- 只有真正会阻塞执行的问题才拒绝
- 一次拒绝最多给 3 个 blocker

---

## 1.10 Multimodal-Looker（多模态文件解释代理）

### 核心身份

- 当文件不是纯文本可直接读时，用它来解释：
  - PDF
  - 图片
  - 图表
  - 结构图

### 它做的事

- 深读目标文件
- 只提取你要求的内容
- 不输出多余铺垫
- 不处理源码级精确编辑场景

---

## 1.11 Sisyphus-Junior（分类执行器）

### 核心身份

- 一个聚焦型执行器。
- 接到清晰任务后直接做，不承担大编排职责。

### 核心约束

- 多步工作必须维护 todo / task
- 结束前必须 diagnostics 干净
- 能 build 的要 build
- 做完一次成功验证后就停，不要无限复检

---

## 2. 模型变体 / Overlay 的中文整理

---

## 2.1 Sisyphus Gemini Overlay

这是此前最容易漏掉的一块。

### 它为什么存在

Gemini 系模型在 OMO 的设计里被认为有这些典型偏差：

- 喜欢少调工具、靠脑补
- 不爱委派，喜欢自己做
- 容易没验证就自信宣布完成
- 容易跳过 intent gate
- 容易把“look into”误解成“开始实现”

### 所以它注入了 5 组纠偏提示

1. **Tool Call Mandate**
   - 你必须用工具
   - 不允许只靠内心推理回答代码问题

2. **Tool Usage Guide**
   - 什么场景用 Read / Grep / Glob / LSP / Edit / Write / Task
   - 哪些可以并行，哪些必须串行

3. **Delegation Override**
   - 你不是实现者，是编排者
   - 默认要委派，不能因为“我自己也能写”就跳过委派

4. **Verification Override**
   - 你的自我感觉不可靠
   - 你觉得“应该没问题”时，必须用工具验证

5. **Intent Gate Enforcement**
   - 必须先说出自己识别到的意图类型
   - 没做意图分类前，后续动作都不合法

---

## 2.2 GPT-5.4 Variant 共同风格

多个代理在 GPT-5.4 上有特化版本，常见特征是：

- 用 XML block 明确分层
- 熵更低、指令更集中
- 更少威胁式语言，更多“结构化执行要求”
- 更强调输出约束和块级职责分离

适用文件包括：

- `sisyphus/gpt-5-4.ts`
- `hephaestus/gpt-5-4.ts`
- `prometheus/gpt.ts`
- `momus.ts` 中的 GPT prompt
- `oracle.ts` 中的 GPT prompt
- `sisyphus-junior/gpt-5-4.ts`

---

## 3. 动态 Prompt Sections 中文整理

这些 section 是 OMO prompt engineering 的“积木层”。

### `dynamic-agent-core-sections.ts`

主要负责生成：

- agent 身份块
- key triggers
- tool selection table
- explore / librarian / oracle 说明
- delegation table
- non-Claude planner section
- parallel delegation section

### `dynamic-agent-policy-sections.ts`

主要负责生成：

- Hard Blocks
- Anti-Patterns
- Tool call format
- Ultrawork section
- Anti-Duplication section

### `dynamic-agent-category-skills-guide.ts`

主要负责生成：

- category 描述
- skills 描述
- category + skill 的委派选择说明

### 中文理解

这些文件本质上是在把“规则文本模块化”。
它们不是普通工具文件，而是：

> **真正的 prompt 语料拼装层。**

---

## 4. Built-in Skills 提示词中文整理

---

## 4.1 git-master

### 作用

- 专门负责 git 相关高质量工作流
- 包括：提交、rebase、历史搜索、定位改动来源等

### 中文化要点

- 只在用户明确要求 git 操作时使用
- 强调安全协议：
  - 不乱改 config
  - 不随便 force push
  - 不随便 amend
  - 不跳过 hooks
- 提交时要求先看：
  - `git status`
  - `git diff`
  - `git log`

### 其内部 section

- overview：总体定位
- commit-workflow：提交工作流
- rebase-workflow：rebase / squash 规范
- history-search-workflow：blame / log -S / bisect 等
- quick-reference：快捷参考

---

## 4.2 frontend-ui-ux

### 作用

- 前端视觉与交互设计 skill
- 目标是避免“AI 味很重的平庸界面”

### 中文化要点

- 做出有层次、有节奏、有意图的界面
- 不是机械套组件
- 视觉、排版、配色、间距、动效都要有明确设计理由

---

## 4.3 dev-browser / playwright / playwright-cli

### 作用

- 把浏览器交互、截图、页面验证、自动化测试能力注入 prompt

### 中文化要点

- 需要浏览器时，不靠想象页面怎么渲染，而是实际打开看
- UI 改动后要截图、验证 DOM、验证交互
- 这是“手动 QA 自动化”的关键依赖

---

## 4.4 review-work

### 作用

- 用多代理并行审查已完成实现
- 重点不是“看起来差不多”，而是：
  - 目标是否完成
  - 代码质量是否过关
  - 安全性是否有洞
  - QA 是否真实执行过

### 中文化要点

- significant implementation 完成后必须 review
- 不是装样子地说“看起来没问题”
- 必须拉起多种视角交叉验证

---

## 4.5 ai-slop-remover

### 作用

- 去掉 AI 生成代码里最常见的坏味道

### 中文化要点

- 删掉模板腔 / 过度注释 / 命名空泛 / 为抽象而抽象
- 保持功能不变，只提高代码可信度和人味

---

## 5. Built-in Commands 提示词中文整理

这些 commands 本质上也是 prompt template。

---

## 5.1 init-deep

- 作用：初始化分层 `AGENTS.md` 知识库
- 中文理解：让项目目录拥有层次化 agent context 文件

## 5.2 ralph-loop / ulw-loop

- 作用：启动持续执行循环
- 中文理解：让代理在“直到完成”为目标下反复推进

## 5.3 refactor

- 作用：触发更体系化的重构工作流
- 中文理解：不是盲改，而是结合 LSP / AST / 测试验证做重构

## 5.4 start-work

- 作用：从 Prometheus plan 正式进入执行态
- 中文理解：把 plan 变成当前 active boulder / work session

## 5.5 handoff

- 作用：导出交接上下文
- 中文理解：为跨会话延续工作生成高质量上下文摘要

## 5.6 stop-continuation

- 作用：停止各种 continuation 机制

## 5.7 remove-ai-slops

- 作用：对分支改动做“去 AI 味”整理与复审

---

## 6. 运行时 Prompt 注入机制中文整理

这部分不是“正文 prompt”，但如果你研究提示词工程，它们必须算进整体 prompt surface area。

---

## 6.1 `prompt_append`

### 位置

- `src/agents/builtin-agents/agent-overrides.ts`

### 中文说明

- OMO 支持在配置里给 agent 或 category 追加 prompt 文本。
- 这意味着“源码里的默认 prompt”并不是唯一来源。

---

## 6.2 `file://` prompt 加载

### 位置

- `src/agents/builtin-agents/resolve-file-uri.ts`

### 中文说明

- prompt 可以通过 `file://` 引到本地文件。
- 这是一个很强的扩展点。
- 研究时必须知道它存在，否则你以为“源码就是全部 prompt”，其实不是。

---

## 6.3 Skill prepend

### 位置

- `src/agents/agent-builder.ts`
- `src/features/opencode-skill-loader/*`

### 中文说明

- skill 内容会 prepend 到 agent prompt 前面。
- 所以 skill 不是普通配置项，而是：

> **提示词正文的前置拼接层。**

---

## 6.4 Context injection / Rules injection

### 位置

- `src/features/context-injector/*`
- `src/hooks/rules-injector/*`
- `src/hooks/directory-readme-injector/*`

### 中文说明

- 会在合适时机把 AGENTS.md / README / rules 注入消息上下文。
- 这解释了为什么同一个 agent 在不同目录/项目中会表现不同。

---

## 6.5 Hook message / auto slash command / category reminder

### 中文说明

- hook 还能额外注入系统提醒、命令包装文本、category 技能提醒。
- 这些内容不是传统意义上的 agent system prompt 常量，但它们会影响最终行为。

---

## 7. 此前文档缺失了什么（中文结论）

此前的 `oh-my-openagent-system-prompts.md` 并不是没价值；它的问题是：

### 它主要覆盖了

- 核心 agent prompt
- 一部分研究结论
- 一部分工程原则

### 但它没有把这些东西完整纳入“全部提示词”

- `sisyphus/gemini.ts` 完整 overlay
- `sisyphus-junior/*` 系列
- `prometheus/*` 完整 section 体系
- `hephaestus` 全部模型特化 prompt
- 动态 builder sections
- built-in skills 全集
- built-in commands 全集
- prompt append / file:// / context injection 等机制

因此它适合作为：

> **核心系统提示词整理文档**

但不适合作为：

> **完整 prompt corpus 的唯一依据**

---

## 8. 给研究者的最终中文判断

如果你的研究目标是：

> **“OMO 仓库内置提示词工程的完整面貌”**

那么你现在应该把它理解成 4 层：

1. **主代理 prompt**
2. **模型变体 / overlay**
3. **skill / command prompt**
4. **运行时注入与拼接机制**

这 4 层合在一起，才是比较接近真实运行时的 prompt engineering 全貌。

---

## 9. 最终一句话总结

**OMO 的“所有提示词”不是几份 agent system prompt 常量，而是一整套“主 prompt + 变体 + skills + commands + runtime injection”的分层体系。**

这份中文文档已经按这个真实边界做了完整整理。
