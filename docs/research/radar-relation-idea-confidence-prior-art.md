# Radar：关联、Idea 与可信度语义的 prior art

研究范围：只回答“关系如何分层、事实关系与用户嫁接关系如何区分、机器建议如何表达可信度、Idea 如何不被误读为事实”。以下均来自产品官方文档、正式规范或一方维护的源码/手册；结论是对既有模式的归纳，不替 Radar 作产品决策。

## 最值得复用的模式

| 问题 | 成熟模式 | 一手证据 | 对 Radar 的启发（非决策） |
| --- | --- | --- | --- |
| 关系类型 | 将“主谓宾关系”与关系的限定条件、证据、当前采用状态拆开。Wikibase 明确建模的是 statements and references，而非宣称掌握 truth；Wikidata 的 statement 以 property-value 为核心，qualifier 负责时间、方法、辖区等上下文，reference 指向支持来源，rank 只负责多值中的查询/展示选择。 | [Wikibase Data Model Primer: Statements](https://www.mediawiki.org/wiki/Wikibase/DataModel/Primer#Statements)、[Statements](https://www.wikidata.org/wiki/Help:Statements)、[Qualifiers](https://www.wikidata.org/wiki/Help:Qualifiers#When_to_use_qualifiers)、[Sources](https://www.wikidata.org/wiki/Help:Sources)、[Ranking](https://www.wikidata.org/wiki/Help:Ranking#What_ranks_are_not) | 不必把“来源”“测定方法”“当前优先采用”膨胀成关系类型；它们可作为关系的正交属性。 |
| 事实关系 vs 用户嫁接关系 | Obsidian/JSON Canvas 把用户在画布上拉出的线建模成独立 edge：方向、颜色、自由文本 label；它不因此成为笔记正文里的知识断言。相对地，内部链接实际写入笔记文本。 | [Obsidian Canvas: Connect cards](https://obsidian.md/help/plugins/canvas#Connect+cards)、[Obsidian internal links](https://obsidian.md/help/links)、[JSON Canvas 1.0: Edges](https://jsoncanvas.org/spec/1.0/#edges) | 成熟工具允许“为了思考而连线”和“作为内容而断言”并存；视觉嫁接不必自动升级为事实边。 |
| 机器推断关系 | Connected Papers 明说图中边是由共被引与文献耦合计算出的“相似性”，即使两篇论文不互引也可相连，并反复提示“not a citation tree”。算法边的语义由图例公开，而不是伪装成来源中的事实关系。 | [Connected Papers: How does it work?](https://www.connectedpapers.com/about) | 机器建议应公开其关系语义及生成依据；“相似/可能相关”不能复用“引用/支持”等事实谓词。 |
| 建议进入正式图谱 | Wikidata 的 Mix'n'match 先保存 preliminary / automatically suggested match，用户可以 Confirm 或 Remove；确认后才登记匹配并以该用户的编辑写入 Wikidata。 | [Mix'n'match Manual: match mode](https://meta.wikimedia.org/wiki/Mix%27n%27match/Manual/en#Match_mode_(formerly_known_as_semi-automatic_mode_or_game_mode)) | “候选关系”和“已接受关系”是生命周期状态，不只是同一条边上的低/高分；人工接受是清晰的状态跃迁。 |
| 机器来源的轻量标识 | Readwise Reader 的 AI 自动标签与人工标签行为相同，但用 `#` 前缀作 AI 来源的视觉提示；官方同时警告自动标签可能污染标签库，建议先定制和测试。 | [Readwise Ghostreader: auto-tagging](https://docs.readwise.io/reader/guides/ghostreader/custom-prompts#ghostreader-tagging-tag-at-your-own-risk) | 机器来源可以是正交 provenance + badge，而非新关系类型；但视觉标识不能代替进入正式结构前的确认闸门。 |
| 来源与生成者 | W3C PROV-O 分开 `wasDerivedFrom` / `hadPrimarySource`（从何而来）、`wasGeneratedBy`（经何活动生成）、`wasAttributedTo`（谁负责）；Web Annotation 又允许 creator 是 Person 或 Software。 | [PROV-O](https://www.w3.org/TR/prov-o/#description-starting-point-terms)、[Web Annotation: Lifecycle Information and Agents](https://www.w3.org/TR/annotation-model/#lifecycle-information) | “谁创建”“机器怎样生成”“什么证据支持”是不同问题；不要用一个 `source` 或 `confidence` 字段同时回答。 |
| 可信度展示 | Google PAIR 建议先判断置信信息是否会改变用户行动；难解释时避免裸百分比，优先使用有含义的类别、备选结果、输入依据和低置信时的可行动退路，并对目标用户实测。 | [PAIR: Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/)、[PAIR pattern: Determine how to show model confidence, if at all](https://pair.withgoogle.com/guidebook-v2/patterns) | “82%”不是天然更诚实。面向判断的产品更需要说明“为何建议、依据什么、下一步能做什么”，数值只在已校准且用户能解释时有意义。 |
| Idea / 假设 vs 事实 | Nanopublication 将 assertion、assertion provenance、publication info 分成三个图，并明确 assertion 可承载 hypothesis、claim、negative result 或 opinion；assertion 并不等于真事实。Kialo 同样把 claim 置于支持/反驳网络，来源作为可附加证据，缺证据可被标记 unsupported。 | [Nanopublication Guidelines: Basic Elements](https://nanopub.net/guidelines/working_draft/#basic-elements)、[Kialo: Creating a Claim](https://support.kialo-edu.com/en/hc/creating-a-claim/)、[Kialo: Adding a Link/Source](https://support.kialo-edu.com/en/hc/adding-a-link/)、[Kialo: Marking a Claim for Review](https://support.kialo-edu.com/en/hc/marking-a-claim-for-review/) | “可被关联、可有证据、可被讨论”不意味着“事实”。命题的认识论身份应独立于其图结构与 provenance。 |

## 四个边界的简明归纳

1. **关系语义与关系元数据分开。** 谓词回答“二者是什么关系”；限定条件回答“何时/何地/按何方法”；provenance 回答“从何而来、谁或什么生成”；采用状态回答“候选、接受、废弃”。Wikidata 与 PROV-O 都避免用一个维度承担所有含义。
2. **用户连线不自动成为事实。** Obsidian Canvas 的 edge 是用户组织思考的显式产物；Connected Papers 的 edge 是算法生成的相似性。两者都可以显示在图中，但其语义和权威性与正文中的断言不同。
3. **可信度不是证据质量，也不是共识。** Wikidata 明确 reference 只说明值来自哪里，rank 表示当前共识下的选择，并非准确率；PAIR 又提醒模型分数可能被误读。因此 provenance、采用状态、模型不确定性需要分别表达。
4. **Idea 应保留为命题身份。** Nanopublication 与 Kialo 都允许命题拥有来源、支持/反驳关系和历史，而不把命题强制称为事实。事实化应是额外的判断或状态变化，而不是“连进图里”的副作用。

## 重要反例与限制

- Wikidata 的 `preferred / normal / deprecated` 是共识与查询选择机制，不是概率置信度；`deprecated` 也仍需存在“某来源确实这样声称”的可验证性。[Ranking](https://www.wikidata.org/wiki/Help:Ranking#Deprecated_rank)
- Connected Papers 的线强弱来自相似度算法，不能推导“支持、反驳、因果或引用”。
- JSON Canvas 的自由文本 label 很灵活，但规范没有 provenance、置信度或受控谓词；它适合说明“用户嫁接关系”的产品边界，不足以单独承担事实图谱。
- Nanopublication Guidelines 是社区维护的工作草案，并非标准组织正式标准；可借鉴其 assertion/provenance 分层，不应把其完整 RDF 包装视为 Radar 的必选实现。
