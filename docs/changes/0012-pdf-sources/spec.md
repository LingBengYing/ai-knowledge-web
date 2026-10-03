# Spec

1. `document_originals`启用时，文字模式PDF来源在原sources回读通过后，GET已有document original metadata；document/revision/filename/SHA必须与引用一致，document_type=document、media_type=application/pdf、1..20MiB、精确pinned URL。完整字节MIME/大小/SHA通过后才显示Blob。其他模式与关闭能力的普通文本来源保持原行为。
2. PDF以服务器page作为`#page`导航，打开/下载及内嵌预览并存。明确页级定位，OCR字符区间属于识别文本，不声称PDF字符框或区域高亮。java-pdf-ocr-v1来源标示机器OCR。
3. metadata失效、版本/SHA不一致、请求失败均清除旧来源；新问题、切换身份/范围、关闭来源或离开问答取消在途并释放URL，迟到结果不恢复。
4. `pdf_ocr_upload`启用时上传提示PDF逐页OCR；不额外调用生成模型。实际解析与索引状态仍由Java返回，默认关闭时不得宣称扫描件可识别。
5. 新模块与真实app DOM针对性验证先红后绿，最终语法/完整前端回归。无网页访问、真实模型调用、Git写入、部署或独立部署副本修改。
