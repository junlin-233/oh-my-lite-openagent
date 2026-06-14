# AGENTS.md

## 仓库定位
- 这是一个给 OpenCode 用的轻量全局编排插件仓库，不是普通应用；核心交付物是 `.opencode/agents/**`、`.opencode/plugins/**`、`.opencode/lib/**`、插件托管配置片段 `scripts/managed-config.mjs` 与安装脚本 `scripts/install.mjs`。
- 仓库根目录不应携带 `opencode.json`；这是用户自己的全局个性化配置。provider、model、API key、无关插件和自定义 agent 都必须保留在用户配置中，由安装器合并托管片段。
- 运行时架构的硬约束写在 `.opencode/lib/contracts.ts`，相关测试会校验这些常量与 `scripts/managed-config.mjs` 一致；改角色、可见模式、路由类别前先同步两边。

## 高价值命令
- 安装依赖：`npm install`
- 测试：`npm test`
- 类型检查：`npm run typecheck`
- 构建：`npm run build`
- 本地演练安装器而不写文件：`node scripts/install.mjs --dry-run`
- 安装到 OpenCode 全局配置：`npm run install:opencode`
- 指定 OpenCode 配置目录：`npm run install:opencode -- --config-dir /path/to/opencode-config`

## 推荐验证顺序
- 改 `.opencode/**/*.ts`、`scripts/managed-config.mjs`、安装器或测试契约后，至少跑：`npm test && npm run typecheck`
- 只有在需要确认 TypeScript 输出时再跑：`npm run build`

## 代码与配置边界
- `tsconfig.json` 只编译 `.opencode/**/*.ts`、`tests/**/*.ts`、`vitest.config.ts`；仓库根目录其他 `.ts` 文件默认不在构建范围内。
- `dist/` 是构建产物，源码修改应落在 `.opencode/**` 或 `scripts/install.mjs`，不要把修复直接做在 `dist/`。
- 角色模型配置命令 `/agent-models` 的模板定义在 `scripts/managed-config.mjs`，实际实现是插件工具 `bounded_lite_model_config`，两者要保持语义一致。
- 计划 artifact 默认写入 `<OPENCODE_CONFIG_DIR>/openplan/<session_key>/`，索引为 `openplan/index.jsonl`；不要把用户计划写进 `.opencode/`。

## 安装器与配置合并规则
- `scripts/install.mjs` 只托管并复制 `.opencode/{agents,plugins,lib}` 到目标 OpenCode 配置目录。
- 安装器会覆盖/写入本仓库管理的插件条目与 agent 定义，但会尽量保留用户现有的 provider、model、API key、插件和其他自定义配置；改合并逻辑时不要破坏这一点。
- 写入用户 OpenCode 配置前会生成同目录备份，例如 `opencode.json.bak` 或 `opencode.jsonc.bak`；插件里的模型配置写回也会先写备份。
- OpenCode 配置目录优先级：`OPENCODE_CONFIG_DIR` > `--config-dir` > 平台默认目录。
- npm registry 上的包可能落后于仓库 `main`；文档描述最新行为时，提示用户可从源码安装或用 `npm view oh-my-lite-openagent version` 确认已发布版本。

## 架构约束（测试会卡）
- 只能保留 3 个可见模式：`execution`、`planning`、`deep-planning`。
- 真实角色固定为 8 个：`command-lead`、`plan-builder`、`deep-plan-builder`、`task-lead`、`explore`、`librarian`、`plan-review`、`result-review`；另外 `build`、`plan` 是被隐藏的禁用覆盖。
- 用户只应看到 3 个入口：`command-lead`、`plan-builder`、`deep-plan-builder`；`task-lead`、`explore`、`librarian`、`plan-review`、`result-review` 必须保持 hidden subagent。
- 子编排深度上限是 `MAX_CHILD_ORCHESTRATOR_DEPTH = 1`，不要引入第二层 orchestrator。
- 自定义工具名必须保持 provider-safe，并以 `bounded_lite_` 开头；测试会校验名字不含点号且匹配 `^[a-zA-Z0-9_-]+$`。
- 权限顺序不是随意的：`task` 权限规则里先放 `"*": "deny"`，因为 OpenCode 按“最后匹配生效”处理，测试会检查这一点。
- 真实角色的 bash 权限默认 `"*": "allow"`，只对危险/敏感命令配置 `ask`；被禁用覆盖的内置 `build`、`plan` 仍保持全拒绝。bash 的宽泛 allow 也必须放在具体 ask 前面。

## 测试提示
- `tests/config/*.test.ts` 主要校验 `scripts/managed-config.mjs` 与 contracts/权限是否一致；改 agent 注册、hidden、mode、delegation 时先看这里。
- `tests/runtime/model-config.test.ts` 约束角色模型写入逻辑：只改已知角色；`provider/model` 格式必需；即使模型不在 provider 列表里也允许写入，但要产生 warning。
- `tests/integration/degraded-mode.test.ts` 和 `conformance.test.ts` 校验降级模式与架构不变式；新增功能时不要破坏“可选增强关闭后仍保留同一可见架构”。

## 面向代理的工作约定
- 若 README 与测试/脚本冲突，以 `scripts/install.mjs`、`scripts/managed-config.mjs`、`.opencode/lib/**` 和测试为准。
- 修改角色、路由、权限、模型配置时，优先搜索对应测试并一起更新；这个仓库很多约束是通过测试显式锁死的。
- 若你只是想验证 OpenCode 侧集成，优先用 `node scripts/install.mjs --dry-run` 看目标路径与合并结果，再决定是否真的写全局配置。
- 主体语言使用中文
