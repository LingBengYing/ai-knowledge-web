# 页面接口

image-vectors.mjs独立ImageVectorSession绑定真实indexed PNG/JPEG的document/publication/source SHA及当前编辑权限。读取GET不调用构建；仅ready/missing且当前editable允许无body POST。available不重复建立；错误只能显式刷新，不自动重试。离页、身份/资料变化中止等待并丢弃旧回执；取消不能保证远端停止。

详情独立panel不重建detail-form，因此建立和读取保留整理草稿。当前实际capabilities门禁才显示入口。原图提问提示为范围中全部图片建立当前profile向量，沿原mode=image附件合同、4096 UTF8问题和完整document_ids，最终打开已有typed库内原图。

两个代理新增精确GET/POST /v1/documents/{id}/image-vector和image-vectors.mjs静态资源；拒绝query/body/方法/编码路径。仅精确POST默认180秒，GET与其他JSON保留普通期限，认证/Origin/响应边界不变。

响应十字段必须精确匹配当前document_id/publication_id/source_revision_id/source_sha256；profile_fingerprint、model_revision、dimensions在GET→POST间不得漂移。向量generation/manifest仅available有值。前端不接收原图向量、caption、endpoint或key。
