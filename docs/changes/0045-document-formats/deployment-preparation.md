# Web0045 / Java0059 生产前端制品

2026-10-09。负责人明确发布生产；本记录只认证制品及临时 loopback 发布入口验证，不代替协调者的远程切换结果。准备 worker 未连接或写服务器、未推送、未调用模型，也未启动持久服务。

## 制品

目录为工作区 `.local/release-0059-20261009/`。真实生产基线为 0058，先核对旧包、225 项 manifest 及旧 stage 的每个文件 SHA；新包仍以 `node scripts/external-server.mjs` 启动，不包含开发 server、测试 fixture、业务资料、数据库或私密配置。

| 对象 | SHA-256 |
| --- | --- |
| `frontend.tar.gz` | `389429bdc16b0ee57ba3843b4ab14971450855725e4c63e85ec52322e788f3ad` |
| `frontend-files.json` | `73c6370dac32e4abd454b2a6e768d111c3c28fef4a3065ff0fea74bed718483b` |
| 定制 `scripts/external-server.mjs` | `52d3835152f224a31236d81767509e61d8f04b76aae532eb980114301491066d` |

相对 0058 仅下列 10 个运行文件变化，其余 215 个逐字节保持：

- `public/answers.mjs`
- `public/api.mjs`
- `public/app.js`
- `public/document-originals.mjs`
- `public/document-replacements.mjs`
- `public/file-synopsis.mjs`
- `public/wiki-workspace-api.mjs`
- `public/wiki-workspace.html`
- `public/wiki-workspace.mjs`
- `scripts/external-server.mjs`

9 个 public 文件来自已验证工作树。定制入口只叠加新格式后缀规则与下述附件保护补丁；逆向撤销这两处后，与 0058 入口逐字节相同。免登录 HMAC/共享身份、Wiki 入口、Agent、知识页删除恢复、模型配置和 PDF 资源保持，不增加环境配置。

## 实际发布阻塞修复

首次入口检查确认：Java 返回的 `Content-Disposition: attachment` 被代理原响应头白名单丢弃，实际收到 `undefined`，因此不交付该候选包。原候选包/目录保留在 `frontend-before-header-fix.tar.gz` / `frontend-before-header-fix-stage/`，不用于发布。

负责人允许最小修复后，两个代理只对精确的文档原件、摘要原件、Wiki 原件 GET 内容路由，在 200/206 响应保留固定值 `attachment` 和 `sandbox; default-src 'none'`；已有 `nosniff` 继续固定输出。`inline`、任意 CSP、CORS 与内部头不透传，普通 metadata/API 不获得此例外。原有 Range 请求策略及前端完整 SHA/200 验证不变。

新增用例明确 RED→GREEN；直接执行 `node --test tests/wiki-transport.test.mjs tests/dev-server.test.mjs tests/external-server.test.mjs`，**105/105 通过，0 失败/跳过/取消**。未改问答行为。原 598 项完整回归的 UI/其他输入保持；仅 `scripts/dev-server.mjs`、`scripts/external-server.mjs`、`tests/wiki-transport.test.mjs` 三项随后改变，不能将旧 598 结果宣称为本最终输入的新全量结果。

## 归档与最终入口验证

- `prepare-frontend.mjs` 仅复制 225 个明确运行文件，32 个 JS 运行文件逐一语法通过；制品内 token/private-key/database 签名扫描无命中，不代替整个 Git 历史扫描。
- 使用 `COPYFILE_DISABLE=1 /usr/bin/tar --disable-copyfile`；独立 CommandLineTools Python `tarfile` 检查 regular 文件集合恰为 manifest 的 225 项、无重复/AppleDouble/符号链接或其他特殊条目，全部正文 SHA 与大小吻合。
- `test-frontend-entry.mjs` 直接导入最终 stage 的定制入口，**280 检查通过**：免登录首页/共享会话、经典入口、改动模块及188个 PDF 资源逐 SHA、Agent、Wiki/lifecycle、21 格式上传与替换、200/206 原件附件保护、同源及精确路由拒绝。55 次合成业务转发，0 模型请求；测试结束关闭临时端口。
- 最终 288 个仓库输入绑定为 `frontend-source-inputs.json`，规范 JSON SHA `9a48ad881bb0a9ac9b6098738a8ccb7e3935856605ad576c76a991ea4a04598d`；打包及入口验证后再次逐 SHA 检查无变化。
- 完整制品/证据元数据见 `frontend-bundle.json`、`frontend-archive-verification.json`、`entry-verification.json`、`entry-verification.log`。root 的部署脚本与总 `bundle.json` 未修改。

真实 XLSX 本机页面验收见 [browser-verification.md](browser-verification.md)；本记录不认证新格式模型索引质量、线上切换、长期容量或未重新执行的全量后端门禁。
