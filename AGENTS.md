## AGENTS.md
- 不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。
- 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。
- 系统分层长。先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。
- 组件保持模块化，关注点分离。
- 优先用成熟的、有人维护的库。没有明确理由别自己重写。
- 先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。
- 架构决策往长了做。不接受"先这样以后再换"的临时方案。
- 先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `s0ftnote/radar`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels without overrides. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

## 往出厂来源目录加源

目录是仓库里的一个数据文件，改动走普通 PR，没有投稿或审核机制。一条端点要进目录，四条都得满足：

- **许可允许机器读取**——存疑就不进（AIHOT、follow-builders、last30days 已按此排除，见 [#39](https://github.com/s0ftnote/radar/issues/39)）。
- **无需登录态**，或明确归入 `配置后解锁` 渠道由用户 Agent 采集推送。
- **端点稳定、能长期存在**，不是某人临时搭的转发。
- **不是观点清单**。「值得盯的人」这类名单不进目录（[#42](https://github.com/s0ftnote/radar/issues/42)）。

端点的 `id` 一旦发布就**永不复用、永不改写**；换地址改 `url` 字段，不要新开一条。下架用 `retired` + 一句理由，不要删行。见 [ADR 0014](docs/adr/0014-the-factory-catalog-ships-with-the-version-and-reconciles-on-upgrade.md)。

<!-- lorekeeper:enabled -->
