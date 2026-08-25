# Radar 的运行时是一个 Node 进程，不是 Next 应用

Radar 砍掉 Next 与 React，保留 TypeScript。一个常驻 Node 进程同时是按计划采集的调度器、SQLite 的唯一写者、`radar` CLI 的服务端，以及那张来源页的 HTTP 服务；路由用 Hono，来源页用模板字符串服务端渲染。整个包作为 npm 全局包发布，`radar` 是它的 bin。

当初选 Next 是为了 Web 上的判断台、Report 台、Brief 列表与详情页，[ADR 0013](0013-the-web-is-one-source-page-everything-else-is-conversation.md) 把这些全删了——现在一个 Next 应用在扛一张读多写少的页。更硬的理由是调度进程无论如何都得存在：Radar 要按计划采集，Next 不做这件事，所以架构上必然有一个常驻 Node 进程；既然它在，让它顺手吐一张 HTML 是几十行的事，反过来为那张 HTML 背一个 Next，就是一个包里塞两个运行时。第三条是这个决定直接影响分发能不能落地：`npm i -g` 一个 Next 应用要连 `next build` 产物一起打包、体积 200MB 起，而一个 Node 进程是几 MB。

迁移成本之所以可以接受，是因为 `lib/` 早就是干净的——1077 行领域逻辑里没有一个 `next` 或 `react` import，只用 Node 内置的 `node:sqlite`。要动的只有 `app/api/` 那五个路由处理器与 layout/样式/字体的搬家。替代方案是留着 Next 熬到前端真的需要它，否掉的理由是 ADR 0013 正是为了让那一天不要到来；为一个被明确排除的未来付常驻成本，是「先这样以后再换」的反面版本。

`node:http` 裸写同样零框架，但十来个内部端点加静态资源意味着自己维护路由、参数与 body 解析——那是要长期背的一百多行基础设施，换掉一个几十 KB、有人维护的依赖并不划算。

## Consequences

- `lib/` 一行不用改，它本来就与栈无关。
- `app/api/` 的五个路由重写为 Hono 路由。ADR 0012 已把 HTTP API 降为内部实现而非契约，改形状不构成破坏。
- 来源页服务端渲染，不引入 JSX 运行时；`DESIGN.md` 的配色与 ZCOOL XiaoWei 字体照搬。
- [#58](https://github.com/s0ftnote/radar/issues/58) 要删的 Brief 列表页与详情页在这次迁移里自然消失，不必单独删一遍。
- 全局包不再需要携带 `next build` 产物，发布流程少一环。
- e2e 仍用 Playwright，它测的是浏览器行为，与服务端用什么框架无关。
- 这条决定的前提是「Web 只有一张页」。前端若重新变复杂，前提失效，须重新决定——但那本身就该先推翻 ADR 0013。
