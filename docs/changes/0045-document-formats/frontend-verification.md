# Web0045 前端验证

2026-10-09 16:19 +08。前端实现与本地完整回归已完成；后端解析、真实页面操作及生产发布由主任务继续验收。本轮未运行服务、调用模型、推送或部署。

## 已实现

- 同一份格式映射覆盖用户指定的 21 个后缀，统一上传、替换、选择器与原件 MIME；dev/external 两个精确代理均接受这些后缀，仍传送原始 File 字节与原有上传协议。
- 保留 PDF/TXT/Markdown、图片和音视频能力及既有大小边界；格式、资料类型、功能未启用、空文件、文件名和超大文件分别报错。
- 原件仍校验同版本元数据、大小和 SHA。HTML/XML/邮件等只展示转义后的纯文本或下载；新主动内容及 Office 原件的对象 URL 使用 `application/octet-stream`，页面不提供主动打开入口。原件 MIME 元数据与原字节不改写。
- 新 Wiki 的非 PDF 文档位置显示“解析文本”；旧经典入口为新增格式采用相同含义，保留原 PDF 物理页码与旧 TXT/MD 标签兼容。未改问答检索、模型调用、证据校验或状态流转逻辑，仅扩充来源 MIME/展示兼容。
- 保留本工作树已有生命周期、Agent 与生产定制入口修改，没有覆盖并行工作。

## RED → GREEN

- 新 `ui-tests/document-formats.test.mjs` 首先覆盖 21 格式上传/替换、错误分型、MIME/SHA/惰性下载及解析文本定位；扩展前拒绝新格式，实施后通过。
- 新经典 DOCX 召回标签测试先得到 `synthetic.docx · 第 1 页`，明确 RED；修改展示后为“解析文本”并 GREEN。
- 新工作台用例核对完整选择器、切换视频类型，以及恶意 HTML 原件只产生转义文本和下载链接，不产生原始脚本或新窗口打开入口。
- 两个真实本机 HTTP 代理分别验证全部 21 格式的上传与替换（每个代理 42 次固定合成字节传送），另保留未知 ZIP 拒绝。
- 旧 `document-originals.test.mjs` 的“HTML 必须拒绝”断言与用户新增 HTML 合同冲突，改为仍不支持的 SVG 拒绝，并由新 HTML 惰性展示/精确 SHA 测试覆盖新行为；其他部分响应、路径、大小、身份不符断言保留，未删除或跳过旧测试。

## 最终一次完整回归

绑定输入 288 个文件，涵盖 `public/`、`entry-public/`、`scripts/`、`tests/`、`ui-tests/`、`deployment-tests/` 与 package/lock。运行前后输入完全一致。

| 命令 | 结果 |
| --- | --- |
| `npm test` | 598 项通过，0 失败、0 跳过、0 取消 |
| `npm run check` | JavaScript syntax checks passed |

执行器：工作区 `.local/web0045/frontend-validation.mjs`。证据文件：同目录 `npm-test.log`、`npm-check.log`、`inputs-before.json`、`inputs-after.json`、`result.json`。

- 输入集合规范 JSON SHA-256：`ea3f7ba37348351aa5560e1be59781c12bd233820800550972dbf5790042048d`
- 完整测试日志 SHA-256：`d74d80e555143af18a210ccc8adfe4853840ace1e43c226235f576ee5a886f83`
- 语法日志 SHA-256：`6c1661f147f54c17396bdacbf3a2bdfab5184b719a7ea08cecaa7d8919676408`
- 完整测试时间：2026-10-09 16:18:59–16:19:34 +08；语法完成 16:19:37 +08。

上述证据只认证当前绑定输入的前端本地行为，不等于真实格式解析、模型质量、浏览器或生产验收。
