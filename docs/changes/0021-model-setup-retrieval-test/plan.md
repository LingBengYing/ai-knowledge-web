# Plan：独立Module与实际页面

C ownership：新增 `public/model-configuration.mjs`、`public/retrieval-tests.mjs` 与对应 Module tests；必要修改 `public/api.mjs/app.js/index.html`、`scripts/dev-server.mjs/external-server.mjs` 以及对应代理/DOM tests。不改后端A/B/root ownership。先写工作区 `.tools/model-configuration-preparation/frontend-draft`，正式窗口开放后已按13个明确文件逐项落盘；styles沿原布局无需改动。

1. 先写行为测试稿：角色草稿→显式save/test/apply、write-only输入清理、unknown只读确认、版本/身份迟到；召回完整scope与SHA/score/rank、停止与原件导航。
2. 独立Module隐藏校验与状态；页面只渲染纯文本、处理显式动作和身份生命周期，避免把凭据复制进渲染快照。
3. 接入实际设置/问答DOM、索引未配置提示与既有资料/原件导航；两代理只增精确路由和单路预算。
4. 开放正式窗口后执行相关测试、完整前端测试与syntax；每条Node/涉及Git命令使用以 `/Library/Developer/CommandLineTools/usr/bin` 为首的固定PATH。保留第一次真实失败及最终输入SHA；不把草稿存在称通过。
5. 协调方串行后端构建与真实Spring/本机替身主线，前后端最终文档以实际证据绑定。无浏览器/真实调用/部署/Git写入。

隔离草稿最终420项与syntax通过；新增26项（Module15、DOM4、API1、代理6），原394项保留。正式源SHA与草稿绑定，但正式输入最终复验仍由协调方执行。本轮未运行Java构建。
