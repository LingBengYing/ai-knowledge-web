# 0007 图片稳定切片验证 — 2026-10-02

实现范围为独立前端与开发传输。Java基线26f9c43c6d5173a372fad73e96c088c4eb00caae；前端从f200f0bb4039513ff9b2dd1307b5d2934b1a36d6继续。本切未提交/推送/部署，Git由专门任务处理，Java/Python生产源码和旧服务数据未改。

## 用户可完成的步骤

- 配置声明image_text_upload或visual_image_upload与ingestions后，上传PNG/JPEG原始File。图片最大10MiB，文本仍20MiB；图片解析/索引复用现有持久任务和终态列表回读。
- 上传对话框说明当前图片走OCR还是视觉模型；同时启用时视觉优先。提问页面显式选择文字证据（含OCR）或原图视觉，不推测历史资料类型。
- 全部所选ID原样发送；OCR复用answers，视觉使用visual-answers，无自动切换、降级、截断或重试。
- 点击引用回读当前metadata和content；文本/视觉typed字段复核，原图仅PNG/JPEG且有界读取，SHA-256匹配才创建Blob URL。视觉引用无虚构页码/quote；OCR显示服务器词框，legacy无框只显示整图，v2拒绝缺失/不相交区域。
- 原比例显示原图，提供下载与关闭；身份/模式/范围/新问题、离开问答或pagehide使旧图失效并释放URL。

## 必要功能验证

图片模块9项新用例在旧源码实际7失败/2通过，代理4项先失败（404/限制未实现），再实现。原代理“未知视觉路由”的旧检查改为仍未知的visual-answers/extra；不是删去路由拒绝断言。首次代理RED因限额未实现导致意外启动临时测试监听，已结束本次测试进程；不涉及业务服务。

- `npm run check`通过。
- 受影响范围`image-answers、answers、ingestion、api、task-detail、markup、dev-server`共106项通过（加入最后2项页面用例前）。
- 最后页面用例加入后，`task-detail、image-answers、dev-server`共74项通过，失败/错误/跳过0。覆盖上传模式、真实app视觉POST完整范围、原图展示、无文字locator与离页清理。
- 未重跑无关全面评测、全部Java或独立审查；用户最新指示优先主线。既有139项测试保留，当前新增15项，不以历史全量结果认证新增功能。

实际正常路径使用同一Java基线已编译classes的独立副本、Spring/SQLite、解析/索引子JVM、真实Tesseract5.5.3；模型与向量为已有AnswerProtocolServer/IndexingTestServer和合成视觉响应的loopback夹具。前端实际createApi、AnswerSession和startDevServer贯穿全链；数据目录全新隔离。不是浏览器测试，也不是云模型质量或真实Milvus结论。

| 路径 | 实测结果 |
| --- | --- |
| OCR PNG | 上传→parsed→indexed→指定1份资料文字问答answered→metadata/content→SHA匹配→source ready；1200×220、6个OCR词框 |
| 视觉 PNG | 上传→parsed→indexed→指定1份资料visual-answers answered→typed metadata/content→SHA匹配→source ready；640×320整图，未生成文字页码/摘录 |

OCR合成文件SHA：`95496e41cb518f2694847194de3ec07e868cdd7d035ffe6ea82dea071f524be0`；视觉合成文件SHA：`63b525a3fdd18eed7142b3bef40ae00f7f00ef649f3f6e33d5fe338aa4217069`。实际返回的原图与上传文件一致。13:45 +08:00完成，两个本次Java实例与代理均已正常关闭。私有harness首次编译遇到List通配import冲突，改为显式Color/Font导入后编译成功；属于私有验证代码问题，未改产品或测试断言。

## 剩余主线与边界

用户最终验收为文档、图片、音频、视频均能检索匹配并打开对应原文件或来源，具有适用页码/时间片段。文档文本闭环有0006本机浏览器证据；本切图片有当前Java+前端Module实证和受控DOM显示验证；音视频网页尚未接通。图片真实浏览器、真实provider/Milvus质量、四类公网检索与原素材访问未验收，不能称整体完成。公网由协调任务浏览器验收。摘要/附件/全面评测不阻止先交图片稳定切片；不新增付费调用。

spec1–2对应上传/任务复用与两条真实本机链；spec3对应显式模式和完整scope；spec4–5对应typed校验、SHA、词框与URL生命周期；spec6对应4条新增代理合同；spec7按用户最新指示调整为必要针对性检查，无独立审查或本轮浏览器结论。
