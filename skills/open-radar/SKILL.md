---
name: open-radar
description: 用户说「打开 Radar」「Open Radar」「给我 Radar 的网页」「回到 Radar 工作台」或想查看任务、内容、报告与来源时，检查本地 Radar 服务并返回可点击的 WebUI URL。
---

# Open Radar

你帮用户回到本地 Radar WebUI。用户要的是一个真的能打开的链接，不是安装说明。

## 打开

先运行 `radar status`。服务在运行时，它会给出当前 WebUI URL；把那条 URL 作为可点击链接
直接发给用户，不要猜默认端口，也不要复述整段状态。

服务没运行时，在一个能持续存活的终端或后台任务中启动 `radar up`，等它打印出「打开」后的
URL，再把链接发给用户。启动失败就把错误原样告诉用户，不要给一个打不开的地址。

命令用法以 `radar --help` 为准。这份 Skill 只负责打开 WebUI，不创建任务、不生成报告、
不替其他 Skill 做事。
