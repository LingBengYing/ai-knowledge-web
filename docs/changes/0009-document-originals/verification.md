# 0009 验证记录

2026-10-03，本机实现与交接完成，公网页面由用户验收；本记录不宣称已部署。

## 行为与红绿

- 原文件入口的 API PDF/文本用例及真实 app 跨导航用例在实现前失败；实现后通过，没有删除、跳过或放宽旧测试。原先用资料计数标签断言资料名称的新增测试定位错误，修正为真正名称列表，同时保留精确提问 document_id 断言。
- Spec 1–2：当前详情保存身份与 metadata 八字段、pinned URL、1..20MiB 大小、实际 Blob SHA 一致后展示 PDF、纯文本、图片、音频或视频。打开/下载链接使用验证后的 Blob。未知 MIME、非200、HTML、query、超限、错误身份/版本/URL或损坏字节均拒绝；401 清理上下文。六种 Session 输入和真实 app 五种展示/链接得到回归覆盖。
- Spec 3：两阶段取消与迟到返回不可恢复 URL；关闭与跨页停止媒体、取消请求、撤销对象 URL；换资料、身份变化和重复关闭回归通过。后台任务刷新保留未保存整理草稿。音视频 codec 错误保留下载入口并提示。
- Spec 4：两个代理仅加入精确 metadata/content GET 与新静态 Module。原文件20MiB、普通10秒；其他方法、query和任意路径拒绝，认证外部代理仍要求会话。既有认证、来源与上传边界回归保留。
- Spec 6：PDF详情→在本资料中提问→返回资料→点击图片，旧详情关闭，图片详情及实际问答 POST 的完整 scope 为图片。取消离开脏表单后页面/原提问 scope 均保留；确认离开才改变 scope。既有任务页面草稿返回工作流保留。

## 命令与贯通

仓库根目录执行 `npm run check` 与 `npm test`，Git测试使用 CommandLineTools Git PATH：185项通过，0失败/取消/跳过。`git diff --check`通过。日志为工作区私有 `.local/document-originals-final-node.log`。未暂存、提交、推送或改索引。

后端0021与原入口/认证/架构/管理相关66项Java回归、590文件Spotless和package成功，见后端0021 verification。没有运行默认完整Java评测。

当前生产Java/SQLite、原生FFmpeg/Tesseract、前端API/Session和精确开发代理完成真实HTTP贯通：合成TXT、PNG、WAV、MP4上传/解析/索引，PDF上传/解析；五种原文件metadata与原字节SHA校验后均ready。模型与Milvus为loopback夹具；未操作浏览器或付费服务。结果在新交接 `native-originals-result.json`，私有日志 `.local/document-originals-native.log`；临时服务已关闭。

## 交接和未验证项

新建工作区 `.tools/document-originals-handoff`，冻结源码manifest、相对上一稳定点的补丁和构建JAR。部署副本的免登录签名与身份表单调整独立存在，发布者须局部应用补丁并保留它们；主线没有覆盖或部署隔离副本。

用户验收现有保存PDF/图片/音频/视频详情的实际显示、播放、打开/下载，以及跨页再打开新资料时的scope。此次本机HTTP和VM回归不替代这些公网/浏览器结果。真实音频Cedar→Car与数字偏差保留待诊断，不据成功读取原文件宣称音频问答质量通过。

偏离：按同一轮用户复现同时修复跨导航旧详情/scope；后端既有0020 Policy层依赖先修复，再统一clean构建。未扩展到删除、摘要、权限增强或全面评测。
