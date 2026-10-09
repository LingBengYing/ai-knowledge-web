# 0044 生产入口验证

2026-10-09 15:54 +08已随后端0058发布`20261009-wiki-lifecycle-0058`。

- [制品准备](deployment-preparation.md)的225文件摘要全部核对，前端没有混入本机数据/密钥/开发代理；既有免登录与Agent保留。
- 生产知识页与“已删除”入口实际浏览器加载成功，页面显示清理后空库。未创建、删除或恢复任何生产资料；本机新增合成页的完整删除/恢复证据见 [browser-verification.md](browser-verification.md)。
- 公网HTTPS证书验证及20项检查通过，包含前端Wiki模块逐SHA、active/deleted接口、不存在ID双CAS删除/恢复404及内部回调404。没有模型调用。
- 三服务active且NRestarts=0，后端schema32→33保留现有业务行/原文件。旧前端、旧包、停机备份保留；新库不能直接切旧schema32后端，开放后回退必须保留兼容后端和新数据。
- 截图与原始结果在工作区`.local/release-0058-20261009/production-deleted.png`和`public-smoke.json`；完整迁移记录见后端0058 `deployment-verification.md`。

未Git推送，未重新执行全仓回归/真实模型质量/长期负载；既有旧失败不因此次增量发布被记为通过。
