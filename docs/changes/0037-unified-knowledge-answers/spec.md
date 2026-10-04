# Spec

`#/answers`默认综合模式，调用后端`POST /v1/knowledge-answers`（question/document_ids）。返回最终answer_id/status/answer/reason/citations，不在浏览器拼候选上下文或自行调模型。

每条引用按evidence_kind=document_text/video_transcript/video_subtitle/video_frame_ocr校验，含citation_id/document_id/revision_id/filename/source_sha256/media_type/quote/text_sha256/origin/content_url/source_url。文档为page/start/end；视频为start_ms/end_ms/time_precision；不适用值为null。来源精确`GET /v1/knowledge-sources/{answerId}/{ordinal}`，返回{answer_id,citation}。引用类型决定PDF页或视频时间播放，保留原件metadata/完整SHA与Blob释放。

去掉独立产品帮助导航、专用资料动作；旧hash重定向知识问答且保留可用问题/完整范围。普通选择不按扩展名自动切视觉；原专门模式显式选择保持。能力未配置仍可写问题，显示模型设置/资料导入入口；返回只读刷新能力，不自动提交。保持epoch、取消、错误/空/拒答状态与显式空范围。

用户停止全部自动化测试/检查/审计；仅本机页面观察，不发模型请求。模型/质量/引用播放未验必须明示。
