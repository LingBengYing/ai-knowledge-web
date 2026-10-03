# 合同

- SW-01：`file_synopsis/synopsis_sources`同时启用且真实资料已有active revision/publication才读取摘要；创建额外要求当前can_edit并显式确认外部模型处理。无能力/未索引/只读显示正确说明；不以摘要失败撤销索引。
- SW-02：精确GET/POST `/v1/documents/{id}/synopsis`、GET `/v1/synopsis-tasks/{id}`。POST无body/query，仅一次；queued/processing约1.5秒轮询，available读取持久摘要，unavailable/cancelled停止并显示安全原因，网络错误暂停待手动刷新。无自动创建或写重试，不伪造取消接口。404表示当前无可读摘要，不展示旧正文。
- SW-03：当前文档ID、publication/revision/sourceSHA与摘要核对；最多32条entry及每条1..8库内引用，one-based ordinal与精确source_url核对。分组展示overview/topic/term/timeline，全文纯文本，时间由服务器微秒区间给出，保留原条目顺序。
- SW-04：GET `/v1/synopsis-sources/{synopsisId}/{1..32}/{1..8}`，逐项核对entry/source/evidence ID/kind/SHA及时间。支持text/image_ocr/image/audio_transcript/video_frame/video_transcript/video_ocr/video_subtitle。文本SHA、完整原文件SHA及video_frame引用原帧SHA在客户端核对；video_ocr的HTTP合同未提供独立帧SHA，由专用授权接口读取且不宣称客户端独立SHA认证。
- SW-05：来源可打开/下载完整原文件，文本页/CP、图片OCR框、音视频时间播放、视频原帧/OCR和字幕定位可见。内容仅服务器精确`/content`与`/frame`，不创建自由URL。1..20MiB原文件、1..10MiB帧；仅完整200响应，无Range转发。关闭/离页/身份或publication改变停止轮询和读取、撤销Blob/停止播放；迟到任务/摘要/来源不得覆盖新详情。摘要刷新保留整理草稿。
- SW-06：两个代理增加精确路由/静态Module；POST和GET均无query/body，维持普通10秒/128KiB请求/4MiB JSON响应。content独享20MiB、frame10MiB；不扩大答案、附件、资料上传、Host/Origin/身份或Cookie合同。

正常路径验收覆盖四类已发布资料生成到摘要及typed来源、失败/重试/重新读取、只读与能力、草稿保留、切换停止；必要完整前端回归。浏览器/真实模型/生产未执行不记通过。
