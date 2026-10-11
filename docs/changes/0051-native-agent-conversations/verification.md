# 本机验证

2026-10-11，基线5c5fd79b376c45395918a3e20bd8d8ac2f60bf2b及本变更工作树。后端对照ai-knowledge的0070。

## 自动化

完整前端回归506/506通过，0失败/跳过，串行约8.9秒：

```sh
PATH=/Library/Developer/CommandLineTools/usr/bin:/Users/linbenyin/.nvm/versions/node/v22.23.2/bin:$PATH node --test --test-concurrency=1 --test-reporter=tap ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs
```

新增覆盖对话CRUD协议、严格DTO、历史分页聚合、原生Agent身份、追问携带conversation_id、刷新只读恢复、压缩状态、引用返回、未知提交核对、切页创建锁。代理实际loopback HTTP覆盖所有运行入口的路径/方法/查询参数，DELETE无body。

JS语法、git diff检查通过。早期完整运行的Git路径问题改用CommandLineTools Git解决，未接受Xcode协议；新发现的DELETE body和查询参数白名单问题已修复。最终完整运行全部通过，不以早期失败记录替代最终结果。

## 复核

独立只读复核确认分页DTO前后端一致、按实际页面长度推进offset，所有原始轮次校验后聚合；引用返回当前对话URL；提交结果未知时保留锁并提供只GET核对入口；旧路由创建请求完成不污染新页面。

## 验证边界

本机联调使用隔离合成资料、真实Java/SQLite/Python HTTP和loopback模型/向量替身。真实供应商请求0；不修改用户18090实例、生产服务或资料，不推送Git。未验证真实模型的压缩语义质量、全库问答质量或正式生产发布。

## 实际页面与重启回读

最终联调目录`/private/tmp/native-agent-integration.RuoNci/verification.json`：两份新合成资料自动索引、两轮搜索阅读问答、对话CRUD/分页/一次压缩，以及同库Spring重启后零新增模型回读通过。

浏览器打开`http://127.0.0.1:18231/#/ask`，实际从列表选择对话，看到两轮原始问答及“已压缩1轮上下文”。打开第一轮原件可阅读，点击返回恢复同一`#/ask/{id}`；实际改名为“灯塔项目 · 连续对话演示”，刷新后新标题、两轮正文和压缩状态仍在。浏览器阶段未再提交问题，也未删除对话。

页面截图：[conversation-proof.jpg](./conversation-proof.jpg)。实际合成预览保留18231；这不是用户18090实例或生产入口。旧临时浏览器标签曾停留在重启时的连接失败页，新标签打开已恢复服务成功，不属于应用问答失败。
