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

<!-- lorekeeper:enabled -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
