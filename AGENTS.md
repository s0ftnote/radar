## AGENTS.md
- 废弃路径直接删。不留兼容层、回退机制或迁移方案，不以维护向后兼容性为目标。
- 接口按长期演进设计，实现按当前需求最简做。边界画在能撑住演进的位置，边界内只填当前需要的东西：不引入缺乏需求依据的抽象、配置项和间接层，也不采用预期后续要替换的权宜方案。
- 先交付 walking skeleton——能端到端跑通的最小版本，再在可用的产品上逐步加功能。不要以尚未成熟的复杂性替换已经能用的东西。
- 先查现有依赖的能力，再考虑新增依赖，最后才自己实现。查文档和类型定义确认，不要未经确认就断定某个库做不到。
- 设计前先看 prior art：成熟产品如何解决同类问题，优先采用经过验证的模式和约定。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `2093686099/radar`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels without overrides. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

<!-- lorekeeper:start -->
## Lorekeeper

- 在可能复用既有知识的工作前，扫描 `lore/MAP.md`；完成实质性工作后，运行一次 `$lorekeeper` skills 记录持久经验。
- 保持项目原有来源为权威，MAP 条目只作指针。仅在确认内容与目标后毕业。
<!-- lorekeeper:end -->
