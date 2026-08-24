# Radar Project 共享来源但不共享判断

Radar 将 Source Network 取得的同一来源版本作为可跨 Radar Project 共享的来源事实，但 Signal、情报条目、外部对象、关系、Idea 及其行为和修订状态都归属单个 Project。跨 Project 复用语义对象时创建保留出处的独立副本，不让一个 Project 的 Brief、反馈、复核或修订静默传播到另一个。

## Consequences

- 同一来源版本可被多个 Project 独立匹配并分别形成 Signal；文本相同不足以合并不同外部来源的身份。
- Project 副本从复制时的源修订快照开始独立演化；源对象后续变化、复核或删除不自动传播。
- MVP 只提供带出处的复制和共享来源引用，不提供语义对象的实时引用、移动、跨 Project 合并或双向同步。
- 单个 Project 的完整导出固定共享来源和复制出处快照，以便脱离其他 Project 仍可阅读和审计。
