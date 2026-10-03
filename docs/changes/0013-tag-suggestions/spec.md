# Specification

能力tag_suggestions与现有file_synopsis/synopsis_sources共同有效时，详情中提供“从摘要推荐标签”，说明不会自动保存。仅当前已索引非合成且available摘要可请求；GET响应document/publication/revision/source SHA/synopsis/input/model/摘要policy与当前详情/摘要逐项匹配。候选序号连续1..8，短标签Unicode≤40、无控制符/逗号分号、去重；fingerprint小写64hex。existing_tags有效、can_apply为boolean；读者查看，编辑者勾选尚未存在候选。

确认POST只发suggestion_fingerprint/ordinals，不发标签正文。保存会追加并去重保留当前已有标签；无选项、只读或资料/摘要身份变化禁用。已有整理草稿时先提示保存或放弃，不丢草稿；错误409/404提示刷新当前摘要与建议，不悄悄重发。GET取消或迟到结果不能污染新资料；POST发出后不能承诺撤销，离页晚响应仅丢弃界面更新。成功验证DocumentResponse同资料/source/revision/publication，再刷新列表、标签筛选和建议状态。能力关闭不发新请求。

只增加两个精确代理路由，使用普通JSON/10秒/既有体积限额；不套查询附件长超时。文本安全渲染，不创建新Blob/外链，不执行候选内容。
