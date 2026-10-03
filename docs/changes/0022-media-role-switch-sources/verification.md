# Verification：本机前端已通过

状态：LOCAL_VERIFIED。新DOM用例实际复现旧图片引用在visual_answers关闭、visual_sources保留时不能打开原图；仅改app.js的来源能力判断，同一用例GREEN。新提问仍要求原问答能力。

root实际运行 `npm run check`、`npm test`：431项通过，0失败、取消、跳过或todo；64完整执行输入前后相同，原430项身份及重复次数保持。证据位于工作区 `.tools/media-role-switch-preparation`，完整日志 `frontend-full-first.log` SHA256 `8d14a22f9c93d35eea8b6185768a4c05ba5ee61c74551c22a892a96e5d20be90`。此次为实际重跑，非复用。

后端0034相关66/full3075及六Native实际通过，原门禁保持；source GET保留权威读取，旧POST门禁原已生效而未额外重写。新累计补丁在0030完整public/scripts副本实际dry-run/apply，27文件与当前相同；新SHA为6a6e0c81d12d430fe197e8df7111ce66de9a755ab084a0059a7ab3f9ade205ea，现网fork未适配或检查。

本机DOM及合成HTTP不替代浏览器、真实模型或部署；这些仍为NOT_RUN，页面由用户验收。retrieval-only范围入口等原未完项保持，目标active。
