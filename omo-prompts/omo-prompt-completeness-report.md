# OMO 提示词完整性核查报告

> 项目：`D:\omo_research\oh-my-openagent`
> 核查日期：2026-04-21
> 目的：确认“所有提示词”是否已经被 100% 完整提取，并明确中文翻译的真实边界

---

## 结论

**结论：此前的 `D:\omo_research\oh-my-openagent-system-prompts.md` 不是 100% 完整。**

它覆盖了大量核心 agent system prompt，但**没有完整覆盖**以下同样属于运行时提示词面的内容：

- 部分 **模型变体 / overlay**
- 部分 **动态 prompt section builder**
- **内置 skills** 的提示词模板
- **内置 commands** 的模板提示词
- 若干 **运行时 prompt 注入 / append / file:// 加载机制**

因此，如果目标是研究 **OMO 在仓库内置范围内、运行时真正会影响代理行为的全部提示词语料**，此前文档只能算 **大体覆盖核心 agent prompts**，不能算“百分百完整”。

---

## 本次“100% 完整”的定义

本报告采用的完整性范围是：

## **仓库内置、会在运行时进入代理提示词面的全部提示词语料**

### 纳入范围

1. **内置 agent system prompts**
2. **模型特化变体**（GPT / Gemini / Default / Codex 等）
3. **动态 prompt 组装 section**
4. **内置 skills 模板**（会 prepend / inject 到 agent prompt）
5. **内置 slash command templates**
6. **运行时 prompt append / file:// / 环境上下文 / 规则注入 / context injection 等机制说明**

### 明确排除项

以下内容**不计入本次“100% 完整提示词语料”声明**，除非它们被内置逻辑直接嵌入运行时提示词：

- `*.test.ts` 测试文件
- `AGENTS.md`、README 等纯文档本体
- 用户自己在 `.opencode/`、`.claude/`、自定义 skill/agent 中额外放入的外部文件内容
- 运行时可能通过 `file://` 指向的**仓库外部**自定义 prompt 文件本体
- 纯类型定义、barrel exports、无 prompt 内容的工具/工厂文件

换句话说：

> **本次“完整”指的是 OMO 仓库“内置 prompt surface area”的完整，不是“所有用户未来可能动态喂进去的外部文本”的完整。**

---

## 为什么此前文档不完整

此前文档 `oh-my-openagent-system-prompts.md` 的问题不在于“完全错误”，而在于它把重点放在了：

- 主 agent 提示词
- 若干核心工程原则
- 研究性整理

但没有把下列内容完整纳入“提示词语料”范畴：

### 1. 内置 skills 也是 prompt

`src/agents/agent-builder.ts` 中会把已解析的 skill 内容 prepend 到 agent prompt 前面，因此 skill 不是附属说明，而是**运行时提示词正文的一部分**。

### 2. 内置 commands 也是 prompt template

`src/features/builtin-commands/commands.ts` 把 command template 包装进：

```xml
<command-instruction>
...
</command-instruction>
```

这同样是运行时 prompt 输入面的一部分。

### 3. Prompt builders / overlays 不是“实现细节”，而是语料本体

像 `sisyphus/gemini.ts`、`dynamic-agent-core-sections.ts`、`dynamic-agent-policy-sections.ts` 这类文件虽然是 builder / section / overlay，但输出的文本会直接成为实际 prompt 内容。

### 4. 运行时 append / file:// / injection 机制必须单独列出

即使不把外部用户文件本体纳入语料，**这些机制本身**也必须写入报告，否则“完整性”是假的。

---

## 完整清单：内置 prompt 语料源

以下为本次核定的**内置 prompt corpus manifest**。

---

## A. Core Agents / 主代理提示词

### Sisyphus

- `D:\omo_research\oh-my-openagent\src\agents\sisyphus.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus\default.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus\gpt-5-4.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus\gemini.ts`

### Atlas

- `D:\omo_research\oh-my-openagent\src\agents\atlas\agent.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\shared-prompt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\default.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\gemini.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\gpt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\default-prompt-sections.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\gemini-prompt-sections.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\gpt-prompt-sections.ts`
- `D:\omo_research\oh-my-openagent\src\agents\atlas\prompt-section-builder.ts`

### Prometheus

- `D:\omo_research\oh-my-openagent\src\agents\prometheus\system-prompt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\identity-constraints.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\interview-mode.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\plan-generation.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\high-accuracy-mode.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\plan-template.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\behavioral-summary.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\gpt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\prometheus\gemini.ts`

### Hephaestus

- `D:\omo_research\oh-my-openagent\src\agents\hephaestus\agent.ts`
- `D:\omo_research\oh-my-openagent\src\agents\hephaestus\gpt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\hephaestus\gpt-5-4.ts`
- `D:\omo_research\oh-my-openagent\src\agents\hephaestus\gpt-5-3-codex.ts`

### 其他独立代理

- `D:\omo_research\oh-my-openagent\src\agents\oracle.ts`
- `D:\omo_research\oh-my-openagent\src\agents\librarian.ts`
- `D:\omo_research\oh-my-openagent\src\agents\explore.ts`
- `D:\omo_research\oh-my-openagent\src\agents\metis.ts`
- `D:\omo_research\oh-my-openagent\src\agents\momus.ts`
- `D:\omo_research\oh-my-openagent\src\agents\multimodal-looker.ts`

---

## B. Sisyphus-Junior / 分类执行代理提示词

- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\agent.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\default.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\gpt.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\gpt-5-4.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\gpt-5-3-codex.ts`
- `D:\omo_research\oh-my-openagent\src\agents\sisyphus-junior\gemini.ts`

---

## C. 动态 Prompt Builders / Sections

这些文件不是“外围工具”，而是**直接生成 prompt 文本的源头**。

- `D:\omo_research\oh-my-openagent\src\agents\dynamic-agent-prompt-builder.ts`
- `D:\omo_research\oh-my-openagent\src\agents\dynamic-agent-core-sections.ts`
- `D:\omo_research\oh-my-openagent\src\agents\dynamic-agent-policy-sections.ts`
- `D:\omo_research\oh-my-openagent\src\agents\dynamic-agent-category-skills-guide.ts`
- `D:\omo_research\oh-my-openagent\src\agents\gpt-apply-patch-guard.ts`

---

## D. Built-in Skills / 内置技能提示词

### 顶层 skill 文件

- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\playwright.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\playwright-cli.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\frontend-ui-ux.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\dev-browser.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\review-work.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\ai-slop-remover.ts`

### git-master skill sections

- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master-sections\overview.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master-sections\commit-workflow.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master-sections\rebase-workflow.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master-sections\history-search-workflow.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-skills\skills\git-master-sections\quick-reference.ts`

> 注：skill 的实际装配还会经过 skill loader / template resolver，但本清单中的文件属于“内置提示词正文源”。

---

## E. Built-in Commands / 内置命令模板提示词

### 命令注册入口

- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\commands.ts`

### command templates

- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\init-deep.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\ralph-loop.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\stop-continuation.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\refactor.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\start-work.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\handoff.ts`
- `D:\omo_research\oh-my-openagent\src\features\builtin-commands\templates\remove-ai-slops.ts`

> `commands.ts` 会把这些模板包进 `<command-instruction>` 等结构，因此它们是 prompt 语料的一部分。

---

## F. Prompt 加载 / 追加 / 注入机制（必须单列）

### 1. agent / category `prompt_append`

- `D:\omo_research\oh-my-openagent\src\agents\builtin-agents\agent-overrides.ts`

作用：

- 支持 agent config 级别 prompt append
- 支持 category config 级别 prompt append
- 属于运行时 prompt 面的重要扩展点

### 2. `file://` prompt 加载

- `D:\omo_research\oh-my-openagent\src\agents\builtin-agents\resolve-file-uri.ts`

作用：

- 支持 `file://` 形式从本地文件解析 prompt 文本
- 说明 OMO 的 prompt 面不仅来自源码常量，也可来自文件引用

### 3. 环境上下文追加

- `D:\omo_research\oh-my-openagent\src\agents\env-context.ts`
- `D:\omo_research\oh-my-openagent\src\agents\builtin-agents\environment-context.ts`

作用：

- 把 timezone / locale / 环境信息附加到 prompt

### 4. skills prepend 到 agent prompt

- `D:\omo_research\oh-my-openagent\src\agents\agent-builder.ts`
- `D:\omo_research\oh-my-openagent\src\features\opencode-skill-loader\skill-template-resolver.ts`
- `D:\omo_research\oh-my-openagent\src\features\opencode-skill-loader\loader.ts`

作用：

- 把 resolved skill 内容 prepend 到 `base.prompt`
- 这是此前文档最容易漏掉、但又最关键的一层

### 5. Context injection / Rules injection

- `D:\omo_research\oh-my-openagent\src\features\context-injector\collector.ts`
- `D:\omo_research\oh-my-openagent\src\features\context-injector\injector.ts`
- `D:\omo_research\oh-my-openagent\src\hooks\rules-injector\injector.ts`
- `D:\omo_research\oh-my-openagent\src\hooks\rules-injector\finder.ts`
- `D:\omo_research\oh-my-openagent\src\hooks\directory-readme-injector\injector.ts`

作用：

- 在特定时机把 AGENTS.md / README / rules 等文本注入对话上下文
- 这些注入内容未必属于“固定内置正文”，但机制本身必须纳入完整性研究

### 6. Hook message / auto slash command / category reminder

- `D:\omo_research\oh-my-openagent\src\features\hook-message-injector\injector.ts`
- `D:\omo_research\oh-my-openagent\src\hooks\auto-slash-command\executor.ts`
- `D:\omo_research\oh-my-openagent\src\hooks\category-skill-reminder\hook.ts`

作用：

- 通过 hook 或命令执行过程，把额外指令性文本注入会话 / 工具输出 / 命令模板解释层

---

## 哪些文件不是 prompt 正文源

以下文件可以帮助理解系统，但**不作为 prompt corpus 正文源**：

- `index.ts` barrel exports
- `types.ts` / schema / interfaces
- 大量 `*.test.ts`
- 纯工厂/路由文件（如果本身不含 prompt 文本）
- `AGENTS.md` 文档本体

这类文件可能出现在研究过程中，但不会计入“已提取完整提示词正文”。

---

## 对此前文档的最终判定

### 文件

`D:\omo_research\oh-my-openagent-system-prompts.md`

### 判定

**不完整，但有参考价值。**

### 为什么不完整

它至少缺失或未完整纳入：

1. `sisyphus/gemini.ts` 的完整 overlay 体系
2. `sisyphus-junior/*` 全套变体
3. `prometheus/*` 的全部 section 文件作为独立 prompt 源
4. `hephaestus/gpt-5-3-codex.ts` 等模型特化长 prompt
5. `dynamic-agent-*` builders 产出的 prompt sections
6. built-in skills 全量模板
7. built-in commands 全量模板
8. prompt append / file:// / skill prepend / context injection 等机制说明

所以它更准确的名字应该是：

> **“OMO 核心系统提示词研究整理版”**

而不是：

> **“百分百完整语料导出”**

---

## 现在可以如何宣称“100% 完整”

只有在以下说法下，这个声明才成立：

> **“在不计入用户自定义外部 prompt 文件本体、测试文件、纯文档文件的前提下，本文档覆盖了 oh-my-openagent 仓库内置的全部运行时 prompt surface area。”**

这个表述是严格、诚实、可复核的。

---

## 给翻译文档的约束

后续中文翻译文档必须遵守：

1. 覆盖上述 in-scope prompt corpus
2. 保留 XML / Markdown / code fence 结构
3. 工具名、路径、模型名、命令名可按研究需要保留英文原样
4. 明确标注哪些是：
   - 主 prompt 正文
   - 变体 / overlay
   - skill prompt
   - command template
   - 运行时注入机制说明

---

## 最终判断

**是的，我已经可以确认：你之前拿到的那份提示词文档不是百分百完整。**

**现在这份报告给出的范围，才是可以用来做“完整中文翻译”的可靠边界。**
