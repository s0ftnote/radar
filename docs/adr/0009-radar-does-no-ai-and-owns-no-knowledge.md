# Radar 不做 AI，也不拥有沉淀

Radar 本体不调用任何模型：打标签、判相关、写理由、出报告全部由用户自己的 Agent 通过 Radar Skill 完成，模型凭据留在用户 Agent 里。相应地，Radar 只存自身运转必需的状态——Radar Brief、来源与渠道状态、待判断队列、Signal 与判断历史、反馈、交付记录——长期知识沉淀归用户自己的知识库（Obsidian、Notion、llm-wiki 等），由 Agent 写入，Radar 不拥有、不连接、不同步。

这两半必须同进同退：Radar 一旦拥有沉淀，就迟早需要模型去维护它（合并重复、随新证据修订、跨条目汇总）；反过来，Radar 一旦调模型，用户就得在 Radar 里再配一份 key、再承受一套模型失败状态，而这些在 Agent 那边已经有了。选择把两者一起推给 Agent，换来的是 Radar 成为一个可以离线跑、无凭据、行为完全可预测的采集与排队组件。

## Consequences

- Radar 没有 BYOK、没有 Plan、没有「模型不可用」这类状态；缺 key 是用户 Agent 的问题。
- Radar 交出去的是判断过的内容（一个判断 = 一次判定，带「为什么给你」），不是资讯流；用途取舍由 Agent 做，Agent 的取舍不回写偏好，只有用户明说的才成为反馈。
- 用户 Agent 不运行时，Radar 只采集不判断，待判断队列堆积——这是正常状态，不是故障。
- 情报库、关系图谱、Idea 画布、Report 与平台物料包、知识库连接器与镜像同步都离开 Radar，归用户 Agent 及其知识库 skills。本决定取代原 ADR 0001–0006。
