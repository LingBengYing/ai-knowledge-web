# Spec

1. 上传明确选择文档/图片、音频或视频；音频WAV/MP3/FLAC/OGG/M4A/MP4/WebM走octet-stream，视频MP4/MOV/WebM/MKV走与扩展名严格匹配的video MIME。对应audio_upload或video_upload及ingestions门禁；1..20MiB，不猜测MP4/WebM流型。实际格式/轨道由Java验证，解析和索引复用原任务。
2. 显式audio问答与video-visual/transcript/joint/ocr/subtitle模式使用对应独立端点与完整document_ids；视频mode必填，不自动切换或删减范围。当前Java不广告OCR/字幕独立问答capability，页面说明须有相应已索引证据，后端缺证据仍拒答。
3. typed音频/视频来源复核身份、原文件SHA、时间及嵌套帧/转录/OCR/字幕字段，不虚构页码。当前授权metadata回读后完整读取原媒体（最大20MiB），SHA匹配后才创建Blob URL；有帧时另验帧SHA。此网页使用完整原文件和浏览器本地Blob定位，不将时间换算成HTTP byte Range，也不新增网络Range代理。
4. 原生audio/video播放器支持从引用时间开始、播放该片段与下载原媒体；实际浏览器codec不支持时说明并保留下载。音频server_chunk不声称逐词对齐，视频保留精确毫秒，展示转录/帧/OCR/字幕适用来源。换身份/范围/模式/问题、关闭来源或离开问答时停止媒体、撤销URL，迟到结果不恢复旧媒体。
5. 精确新增audio/video answers、sources、content以及video frame路由。POST答案180秒；metadata/frame/content普通10秒；原媒体content20MiB，图片content/帧10MiB，JSON4MiB，请求128KiB，上传总上限20MiB/并发2/30秒。保留鉴权、Host/Origin/Cookie、无redirect/no-retry。
6. 必要语法、针对性模块/页面/代理验证及当前Java正常链路；合成媒体、真实FFmpeg/SQLite/worker、本机模型/向量替身。完整评测、真实模型质量及公网四类验收后置，由协调方执行公网浏览器验收。不把本机结果写成整体完成。
