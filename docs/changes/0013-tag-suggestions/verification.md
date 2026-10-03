# Verification：摘要标签建议

2026-10-03本机实现与验证。用户负责网页验收，本轮未访问浏览器、调用真实模型、部署或写入Git索引。

## RED与必要夹具修正

- 真实app DOM：原有50项通过，新增“选择确认/草稿保护”和“离开详情丢弃迟到读取”两项失败，共52项、2失败、0取消/跳过；日志`.local/tag-suggestions-app-red.log`。
- 两个Node代理：原有63项通过，新增静态模块/精确GET与POST传输、非法路由/query/body拒绝相关4项失败，共67项、4失败、0取消/跳过；日志`.local/tag-suggestions-proxy-red.log`。
- 首次实现后app为51/52通过，余下失败来自新增合成夹具的document_id不符合该夹具当前资料身份。修正这一个新增夹具后继续验证；未修改既有有效断言，也不把夹具错误计作产品RED。过程保留在`.local/tag-suggestions-app-first.log`。

## 最终GREEN

- 标签建议Session 7项、真实app DOM 52项、两个代理67项，相关合计126项通过，失败/取消/跳过均0；日志`.local/tag-suggestions-targeted-final.log`。此前Session与app合计59项通过记录保留在`.local/tag-suggestions-targeted.log`。
- `npm run check`通过，日志`.local/tag-suggestions-syntax.log`。
- `npm test`执行仓库既有完整命令`node --test ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs`：258项全部通过，失败/取消/跳过均0；日志`.local/tag-suggestions-full.log`。执行时Git使用已核实的CommandLineTools路径。

验证覆盖：有效摘要/资料身份与能力门禁；读取建议和选择均为0写入；只有显式选择后POST，且正文仅含指纹与序号；候选长度、字符、去重、已有标签、只读与空建议；保存结果须保持同资料/source/revision/publication并包含所选标签；整理草稿保护；新读取取代旧读取、关闭详情后迟到GET/POST隔离；失败显式刷新且不自动重试。真实app验证保存后列表与标签筛选刷新、候选纯文本渲染。并发标签的原子保留及真实SQLite/HTTP证据由后端0024单列，不由前端协议夹具替代。

现有pdf_config实现代理仅对本轮Session/app接线及相邻后端合同进行了静态交叉复核，未发现阻断finding，范围见[REVIEW](REVIEW.md)；该代理没有为文档更新重跑测试。

## 交付边界

当前为本地已验证、尚未部署。前端测试使用合成协议响应、真实app的DOM Adapter以及本机Node代理HTTP；不认证浏览器像素、真实资料分类质量或模型效果。标签从已保存摘要的完整短术语/主题确定性派生，没有新摘要任务、provider配置或模型调用，真实模型调用0。没有适合条目时如实展示无新增建议。

部署交接须保留现网open-access修改，不整包覆盖独立部署副本；既有冻结包保持不变。日志仅保留在本地，后续源码/日志指纹与新交接由root统一冻结，不把本记录当作已经发布或用户页面验收通过。
