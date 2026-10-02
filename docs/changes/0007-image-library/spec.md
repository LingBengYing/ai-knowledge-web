# Spec

1. 上传对话框在Java声明image_text_upload或visual_image_upload及ingestions时允许PNG/JPG/JPEG原始File，1..10MiB；文本仍1..20MiB。保留精确文件名/路径/Unicode检查，POST仍octet-stream。文案说明当前服务器是OCR还是纯视觉配置，视觉描述可能产生模型费用；后端校验实际类型和1200万像素。纯视觉不是OCR失败降级。OCR原图内容另须source_image_content能力；同时开OCR与visual时新图固定走visual，列表与任务不公开parser revision，不能由当前配置推测旧资料的证据类型。
2. 图片复用既有持久解析/索引任务、当前can_index及确认框、终态授权列表刷新；不改active、can_answer或完整selected set。text_index/indexings仍是共享索引能力。
3. 问答页面明确选择“文字证据（含OCR）”或“原图视觉”；前者复用answers/sources，后者同时要求visual_answers/visual_sources且只POST /v1/visual-answers。模式/身份/范围/新问题清除旧答案和来源，无自动路由、降级、写重试或部分集合请求。
4. 纯视觉引用按Javaimage_region合同校验完整身份、整图bbox、尺寸、MIME、模型/策略版本及精确source/content URL，不显示虚构page/start/end/quote。OCR来源复核全部旧文本字段，再检查image和与引用相交的有序ocr_word区域。无区域的legacy来源只显示整图，不推测框；v2不能无框伪装成功。
5. 用户点击来源才GET当前metadata并以同一身份GET精确content路径；只接PNG/JPEG，1..10MiB，实际字节SHA-256与引用一致才创建本地Blob图像。无自由URL/凭据/模型调用；加载失败、换身份/模式/范围/来源、关闭页面清除并释放URL，迟到响应不恢复旧图。图片按原比例显示，OCR仅服务器词框叠加，标明词级非字符级。
6. 开发代理只新增POST visual-answers、GET visual-sources及两种精确/content；无query/body/编码ID/自由链接。视觉POST采用与文字POST相同独立180秒期限；content仅独立10MiB响应预算及10秒期限，普通JSON4MiB/请求128KiB/上传并发2保持，图片上传10MiB不扩大文本20MiB。Host/Origin/认证/Cookie/redirect/no-retry保持。
7. 先失败后实现，保留全部139项既有回归并执行语法/全量/独立审查。浏览器用真实本机OCR及独立JavaSpring上传/解析/索引/问答/source/content走正常路径；外部模型/Milvus可用明确loopback替身，不能认证云语义质量或生产。记录实际验收范围、偏离及未验证项。
