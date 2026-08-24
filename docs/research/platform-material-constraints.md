# 首批平台物料包的公开能力约束

研究日期：2026-08-23

## 研究问题与口径

本研究回答：小红书、X、Threads 以及主流短视频平台当前有哪些能由一手公开资料支持的文字、图片、链接和连续内容能力；这些能力如何约束 Radar 的“文案 + PNG 图片 + 来源信息”物料包模型。

本文只引用平台自己的帮助中心、开发者文档和产品公告。平台客户端与发布 API 是两套不同表面：API 文档能证明 API 接受什么，不能自动证明手机 App 的所有手工发布行为；反之亦然。Radar MVP 不代替用户发布，但现在把两者分开，能避免物料包把暂时的客户端行为写成长期承诺，也为未来的辅助发布留下正确边界。

## 结论

“文案 + PNG 图片 + 来源信息”可以成立为**用户收到的物料包**，但不能成立为所有平台统一的**可直接发布载荷**。

1. PNG 可以作为 Radar 的默认预览和下载格式，但不能是唯一图片衍生格式。X、Threads 和 YouTube Shorts 自定义封面明确支持 PNG；TikTok Content Posting API 只接受 JPEG/WebP 照片，Instagram 发布 API 的静态图片只接受 JPEG。小红书公开的普通笔记资料不足以确认 PNG 是稳定承诺。
2. 来源信息必须存在于物料包，但不必全部出现在平台文案或图片里。X 的链接会占用字符；Threads 的链接预览仅适用于纯文字帖；YouTube Shorts 描述与评论中的 URL 不可点击；TikTok 的开发者准则禁止发布集成给共享媒体叠加链接、水印或推广文字。完整来源清单应独立保存，平台稿只选择适合公开呈现的引用。
3. “视频物料包”在 MVP 中只能叫**制作准备包**：脚本、镜头表、标题/描述、封面和分镜 PNG。YouTube Shorts、TikTok 和 Instagram Reels 的可发布主体都是视频文件，PNG 不能替代视频。
4. 平台模板必须版本化，并记录“依据日期、发布路径、账号能力”。长文、外链、封面、音乐和 API 直发都存在订阅、验证、专业账号、地区或应用审核边界。

因此建议的长期对象不是一个 `png[]` 字段，而是：

```text
平台物料包
├── editorial：标题、正文块、标签、CTA、发布序列
├── render_source：可重新渲染的结构数据与模板版本
├── derivatives：PNG 预览 + 平台需要的 JPEG/WebP 等衍生文件
├── provenance：完整来源、证据与情报节点映射
└── capability_snapshot：平台、手工/API 路径、账号能力、核验日期
```

## 平台事实与产品影响

### 小红书

能够由公开一手资料确认的范围主要来自小红书分享开放平台，而不是普通创作者发布页：

- 分享 SDK 支持图片或视频二选一，视频当前只支持单个；请求模型中存在可选标题和内容字段。[小红书 iOS SDK 接入指南](https://agora.xiaohongshu.com/doc/ios)
- 同一份官方 FAQ 又明确说明，平台已经限制分享 SDK 自动填充标题和文案，新旧接入方都受影响。因此 Radar 即便未来接入分享 SDK，也不能承诺标题和正文会自动带入发布页。[小红书分享开放平台 Q&A](https://agora.xiaohongshu.com/doc/qa)
- iOS 文档公开了旧裁剪规则：最长边超过 1920、宽度小于 600、宽度超过 1280，以及宽高比小于 3:4 或大于 2:1 时会被裁剪；文档同时说不同资源传入方式使用新旧两套裁剪规则，未来还要统一。[小红书 iOS SDK 接入指南](https://agora.xiaohongshu.com/doc/ios)
- SDK 集成需要登记应用、取得 AppKey 和分享权限；错误状态还明确区分未登录、权限不足、相册权限缺失和版本问题。这些是未来“辅助发布”的应用能力门槛，不是普通用户下载物料包的门槛。[小红书 iOS SDK 接入指南](https://agora.xiaohongshu.com/doc/ios)

公开一手资料**无法确认**普通图文笔记当前稳定的标题/正文字符上限、图片数量、图片文件格式和大小、客户端的精确裁剪规则、正文外链是否可点击、是否存在原生连续笔记形态，以及不同账号类型的发布差异。小红书大学中可搜索到的 PNG/JPEG 和 1:1/3:4 规格属于商品资料接口，不能外推成普通笔记规格。

产品影响：

- 小红书物料包应提供独立的标题、正文和标签文本，不能承诺自动预填。
- 3:4 可以作为 Radar 的产品模板选择，且落在已公开的旧裁剪安全区内；但不能把它表述为当前普通笔记的唯一官方比例。
- 用户侧可以收到 PNG，同时保留 JPEG 衍生能力；在真实账号和目标客户端完成一次验收前，不对 PNG 直传、最大卡片数和外链行为作产品承诺。

### X

X 的普通发布边界最清楚：

- 标准 Post 最多 280 字符；每个 Post 最多 4 个媒体项目。长 Post 是 Premium 能力，官方 Premium 页面给出的上限为 25,000 字符。[How to Post](https://help.x.com/en/using-x/how-to-post)、[About X Premium](https://help.x.com/en/using-x/x-premium)
- 照片支持 GIF、JPEG 和 PNG，单张照片最大 5 MB；一次可发 1–4 张。单张图片在 2:1 到 3:4 之间会完整显示，超出后的展示/裁剪不能据此保证。[How to post photos or GIFs](https://help.x.com/en/using-x/posting-gifs-and-pictures)
- URL 会统一经过 t.co；无论原 URL 多长，都按 23 个字符计入 Post 字数。[How to post links in a Post](https://help.x.com/en/using-x/how-to-post-a-link)
- X Thread 是同一作者的一组连接 Post，可一次“Post all”，发布后也能继续追加；当 Thread 达到 4 条或更多时，时间线会折叠并显示“Show this thread”。[How to create a thread on X](https://help.x.com/en/using-x/create-a-thread)

公开一手资料**没有在上述页面给出**一个 Thread 的最大 Post 数，也没有给出多图 Post 每种布局的完整安全裁剪区。长 Post 还受 Premium 订阅和客户端能力影响，因此不应成为默认兼容基线。

产品影响：

- 稳定基线是一个有序的 `post[]`，每条不超过 280 字符，每条 0–4 张 PNG/JPEG，单图模板优先落在 2:1–3:4。
- 来源 URL 必须按每条 23 字符预留预算。完整证据清单留在 provenance；平台稿只携带经过选择的关键链接。
- “X Thread”可以作为原生连续内容模板；Premium 长文应是账号能力开关，不是默认稿型。

### Threads

Threads 的普通产品与官方 API 能确认：

- 普通 Post 最多 500 字符，可包含链接、照片和视频。[Introducing Threads](https://about.fb.com/news/2023/07/introducing-threads-new-app-text-sharing/)
- Threads 已推出最长 10,000 字符的文字附件；这是附加在 Post 上的长文本，不应与普通 500 字符正文混为一谈。[Attach Text to Your Threads Posts](https://about.fb.com/news/2025/09/attach-text-threads-posts-share-longer-perspectives/)
- Threads API 支持纯文字、单图、视频和轮播；轮播最少 2 个、最多 20 个图片/视频项目。图片正式支持 JPEG 和 PNG，最大 8 MB，宽度 320–1440，最大宽高比 10:1，色彩空间为 sRGB。[Threads Posts API](https://developers.facebook.com/docs/threads/posts/)
- API 的链接附件/预览只适用于纯文字帖，不适用于图片、视频或轮播；一个 Post 最多 5 个唯一链接。[Threads Posts API](https://developers.facebook.com/docs/threads/posts/)

公开一手资料**没有在这些页面承诺**客户端手工发布界面与 API 的 20 项轮播能力始终完全一致，也没有给出类似 X “一次发布整组连续帖”的原子工作流。10,000 字符文字附件是产品功能，但当前 Threads Posts API 页面没有把它列为基础发帖参数，因此不能默认承诺自动化路径支持。

产品影响：

- 普通模板以 500 字符为基线；10,000 字符附件作为能力开关。
- 轮播导出可以安全限制在 20 项以内，PNG 单张不超过 8 MB；交付前仍应在目标客户端做手工验收。
- 若要输出“连续观点”，Radar 可以给出编号稿件和建议回复顺序，但不能把它描述成与 X Thread 完全等价的原子发布能力。
- 图片帖需要来源时，应把来源清单与发布稿分开，因为 API 的链接预览不适用于带图帖。

### TikTok（照片帖与短视频）

TikTok 官方 Content Posting API 给出了当前最明确的照片发布约束：

- 照片帖标题最多 90 个 UTF-16 rune，描述最多 4,000 个 UTF-16 rune；一个照片帖最多 35 张，并可指定其中一张为封面。[TikTok Photo API](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post)
- API 照片只支持 WebP 与 JPEG，单张最大 20 MB、最高 1080p；PNG 不在支持列表内。[Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- API 视频支持 MP4、WebM、MOV；所有创作者可以发布 3 分钟视频，部分账号可发布 5 或 10 分钟，应用需要查询创作者实时能力。API 最长可发送 10 分钟视频。[Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- 直发要求已注册应用、获批 `video.publish` 权限并得到用户授权；未审计客户端只能把内容发为私密。上传草稿也要求 `video.upload` 权限，并由用户进入 TikTok 编辑流程完成发布。[Get Started — Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)、[Get Started — Upload](https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content)
- TikTok 对发布集成明确禁止在共享内容中叠加品牌名、Logo、水印、链接或推广文字。[Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/)
- 官方帮助页只承诺：个人账号达到 1,000 粉丝或使用已注册企业账号时可以在资料页添加网站链接，而且此功能并非所有地区都有。[Linking another social media account](https://support.tiktok.com/en/getting-started/setting-up-your-profile/linking-another-social-media-account)

公开一手资料**没有在 API 图片规格中给出**照片帖推荐宽高比，也没有证明手机 App 手工选择照片时会接受 PNG；它也没有承诺普通描述中的来源 URL 可点击。不能用用户经验或非官方教程填补这些空白。

产品影响：

- TikTok 照片物料包不能只交 PNG。可以保留 PNG 预览，但必须能生成 JPEG（或 WebP）发布衍生文件。
- 来源 URL、Radar 品牌和水印默认留在 provenance/交付页面，不烧进准备经发布集成发送的照片。
- 视频脚本若要给出跨账号稳定时长，3 分钟是官方可支持的上限；实际发布仍需要视频文件。MVP 的“脚本 + 分镜 PNG + 封面 PNG”只能标为制作准备包。
- 未来自动发布不是简单增加一个按钮：需要应用审核、scope、用户授权、实时账号能力查询和用户可见的发布选择。

### YouTube Shorts

YouTube 官方资料确认：

- 2024-10-15 之后上传的方形或竖向视频，最长 3 分钟，会被归类为 Shorts；Shorts 可以从 App 或 YouTube Studio 上传。[Understand three-minute YouTube Shorts](https://support.google.com/youtube/answer/15424877)
- 上传界面的标题最多 100 字符；视频通用描述最多 5,000 字符。[Upload YouTube Shorts](https://support.google.com/youtube/answer/12779649)、[Upload YouTube videos](https://support.google.com/youtube/answer/57407)
- Shorts 描述和 Shorts 评论里的 URL 不可点击；可点击的是频道资料链接、Shorts 关联视频链接等另行定义的表面。[Sharing links with your audiences](https://support.google.com/youtube/answer/13748639)
- 当前美国英语帮助页说明，自定义 Shorts 封面只可在桌面 YouTube Studio 添加，账号必须完成验证；推荐 9:16、2160×3840，支持 JPG 或 PNG，并存在按设备、地区和频道历史变化的大小/每日数量限制。[Add custom thumbnails on YouTube](https://support.google.com/youtube/answer/72431)、[Verify your YouTube account](https://support.google.com/youtube/answer/171664)

产品影响：

- 可发布主体必须是方形或竖向视频；PNG 只是封面，不能把视频准备包标成可直接发布。
- Radar 可以稳定提供 100 字符内标题、5,000 字符内描述、9:16 PNG 封面，但必须提示“封面上传需要已验证账号和桌面 Studio”。
- 来源 URL 可以保留在描述供复制查看，但不能承诺可点击；物料包的 HTML/provenance 才是完整可点击证据入口。

### Instagram Reels（补充的主流短视频表面）

- Instagram 发布 API 把 Reels 定义为视频发布，API 发布只面向 Instagram 专业账号；静态图片发布路径只支持 JPEG，不支持 PNG。[Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- Meta 对 Reels 创意的公开建议是 9:16 竖向视频、音频和安全区，但该页面讨论的是广告创意，不能外推为普通 Reels 的唯一硬性比例。[Meta Reels Ads](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)
- Instagram 官方帮助中心说明，某些企业账号、某些帖子类型以及某些国家/地区无法使用授权音乐库。[Access to the licensed music library](https://www.facebook.com/help/instagram/402084904469945)

产品影响：Reels 准备包可提供 9:16 分镜/封面 PNG 作为制作资产，但可发布主体仍是视频；模板不能默认指定一首所有账号都可用的商业音乐。未来若走 API，专业账号与 JPEG-only 静态发布能力必须显式记录。

## 建议的首批物料包能力基线

以下是由公开约束推导出的安全基线，不是平台增长“最佳实践”：

| 目标 | Radar 可稳定交付 | 需要账号/客户端提示 | 不能承诺 |
| --- | --- | --- | --- |
| 小红书 | 标题、正文、标签、3:4 PNG 预览、JPEG 备用、来源清单 | 用户复制文案；发布前客户端验收 | 自动预填、PNG 必然直传、图片上限、可点击外链 |
| X | 每条 ≤280 字符的有序 Post；每条 1–4 张、≤5 MB 的 PNG/JPEG；精选来源链接 | Premium 才用长 Post | Thread 最大条数、多图完整裁剪安全区 |
| Threads | ≤500 字符正文；≤20 项 PNG/JPEG 轮播；独立来源清单 | 长文字附件与客户端轮播需要能力核验 | 与 X 等价的一次性连续帖、带图帖链接预览 |
| TikTok 照片 | 标题、描述、PNG 预览 + JPEG/WebP 发布衍生图、≤35 项、来源清单 | API 审核/scope/账号能力；手工路径需验收 | PNG-only、描述链接可点击、未审计公开直发 |
| 视频制作准备包 | 3 分钟内脚本、镜头表、9:16 封面/分镜 PNG、平台标题与描述 | YouTube 封面需验证账号；音乐可用性按账号 | 没有视频文件却“可直接发布”、通用音乐授权 |
| HTML | 可点击来源、完整正文、图谱快照、平台物料下载入口 | 由 Radar 自己定义浏览器/托管边界 | 把 HTML 当作社交平台原生帖子 |

## 产品模型必须保留的边界

1. **可编辑母版与平台文件分离。** 母版保存文字块、卡片结构、画布、模板与来源映射；PNG、JPEG、WebP 只是可再生衍生物。
2. **发布内容与证据清单分离。** `provenance` 永远完整；`editorial` 只携带适合该平台的少量来源或引用。这样既不丢可信度，也不假设每个平台都能显示、点击或允许所有链接。
3. **连续内容用有序结构表达。** X 可映射为原生 Thread；Threads 映射为编号稿/回复建议；图文平台映射为有序轮播。领域模型不应把三者都叫 Thread。
4. **账号能力是运行时状态。** Premium、验证、专业/企业账号、地区、音乐库、API scope 和应用审核不能写死在模板名称里。
5. **“可直接发布”必须是严格状态。** 缺少目标平台所需媒体、超出限制、来源未处理或账号能力未知时，只能标为“准备完成”或“待发布检查”，不能标为“发布就绪”。

## 仍需真实账号验收的未知项

这些事实无法从本次限定的一手公开资料可靠确认，应在低保真原型之后进入一次小规模、按客户端版本记录的验收，而不是继续从二手文章猜测：

- 小红书普通笔记的 PNG/JPEG 接受情况、图片数量、字符上限、裁剪、外链和账号差异。
- Threads 手机客户端的轮播上限、10,000 字符附件的账号/地区可用性，以及手工连续回复流程。
- TikTok 手机 App 手工照片发布是否接受 PNG、照片推荐比例和描述 URL 的实际交互。
- Instagram 普通 Reels 客户端的自定义封面文件格式、来源链接行为和各账号音乐库。
- X Thread 最大条数及多图组合的逐布局裁剪表现。

验收结果应以“平台 + 客户端版本 + 账号类型 + 日期”记录，不能覆盖本文的一手事实；两者共同组成 Radar 的 capability snapshot。
