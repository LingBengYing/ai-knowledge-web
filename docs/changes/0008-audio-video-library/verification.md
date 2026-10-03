# 0008 本地验证（2026-10-02）

音频和视频网页正常主线已实现，尚未提交/推送。上传类型显式区分MP4/WebM音频与视频，解析/索引沿用真实任务；模式完整发送所选集合；引用无虚构页码，当前metadata、原媒体和原帧分别校验身份/SHA后显示。播放器按服务器时间seek、播放片段与下载；关闭/离开/换问题停止播放器并释放URL。字幕language允许Java合法null；视频微秒级来源的毫秒小数保留显示。

## 必要验证

- 起始media模块5项：4失败/1通过；实现后与图片/文本问答模块31项通过。
- 页面受控DOM核对MP4类型选择、完整scope、音频引用定位/播放停止、离开释放；模块核对video请求mode、精确1.001ms、原帧、SHA和source身份。字幕language=null合同先失败后修正；OCR/字幕typed回读通过。
- 最终`npm run check`、`npm test`：173项通过（含本次合入的外部入口/渲染10项），无失败/跳过。既有用例保留；旧非法video.mp4改为仍不支持video.avi以匹配新增合法音频容器合同。
- 真实当前Java Spring/SQLite/worker + FFmpeg 9.0.2，隔离合成WAV/MP4，loopback ASR/VLM/文字模型与Milvus协议替身：audio、video-visual、video-transcript、video-joint全部上传→parsed→indexed→指定资料answered→source ready。原媒体SHA匹配；画面模式有封存原帧SHA匹配。所有本次进程已停止。
- 后续在整合后的JWT入口和Java代码上重新贯通七条链（PDF、OCR图、视觉图、音频、视频三种模式），见[整合验证](../deployment-external-entry/integration.md)。

## 范围和剩余项

spec1–2对应明确上传/模式和完整scope；spec3–4对应typed来源、SHA、播放器及释放；spec5对应开发/外部入口精确路由/预算；spec6按最新用户要求只跑必要验证，不新建独立检查任务或全面质量评测。前端未同步Java静态文件。

2026-10-02续接已补视频OCR/字幕原生链：当前生产classes、FFmpeg/Tesseract及已有完整装配夹具，真实MP4经上传/解析/索引，实际createApi/AnswerSession以video-ocr和video-subtitle提问并逐引用回读原视频/原帧SHA成功。OCR引用4个选中原帧，每帧6词框；字幕引用500–1250ms、轨语言und。此前只有typed合同回归的限制已由本次证据更新。合成音频为确定性波形，ASR文字由本机替身给出，不证明识别准确性。没有本轮实际浏览器codec播放、真实provider/Milvus或公网验收。四类真实匹配质量、TLS/服务器与公网原素材访问由协调方后续验收；本机结果不能标整体生产完成。没有新增付费调用，旧0019真实失败台账保持。

## 实际页面验收限制（续接）

已创建新的空隔离数据目录，并用真实Java/native worker导入、解析和索引四类合成资料。打开本机页面的cua浏览器调用被权限政策拒绝，具体原因是用户未授予访问权限；没有使用其他浏览器/原始浏览器接口或间接方式绕过。浏览器可见布局、原生codec解码/播放与页面管理操作均未据此次声明通过。

本次新增原生视频来源实证属于Module/API合同，不替代实际页面验收。模型和Milvus依然为loopback替身，真实服务配置与质量仍待协调方完成。既有51文件稳定快照保留；本次仅追加验证记录，不改产品接口、Java生产源码或Git状态。
