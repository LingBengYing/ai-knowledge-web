# 前端合同

三模式video-av-visual/audio/joint映射VISUAL/AUDIO/JOINT；原无附件七字段问答不改。仅video_av_query_attachments实际cap且videoAvEnabled允许VIDEO原件1..3总20MiB，完整读取/canonical编码后新精确POST /v1/video-av-query-answers；保持原文字≤4096UTF8及完整selection，[]不改为全库。禁用旧query_attachments cap代替新cap，不混入图/音附件，不自动重试。

新返回mode/result/query_attachments严格三字段，result经原checkedVideoAvAnswer，mode与当前请求及result一致；每件11字段/ordinal/sourceSHA/compiler/status/count/absence及整体prepared/not_prepared遵后端Q07，失败不丢原输入身份。checked receipts绑定发出的原File SHA、原数量与used_mode；answered全prepared，未知/漏字段、部分组、错误原SHA或迟到结果拒绝。

附件仅检索参考；控件/帮助说明连续画面及原声按所选模式辅助查找，缺音轨的音频/联合参考会整体拒答，仍需文字问题。mode/身份/范围/问题/附件变化和取消使旧响应失效，读取完成后再次检查epoch，旧结果不得覆盖新表单/来源。纯文字与原三模式来源/完整视频SHA/时间打开保持。两个proxy仅精确新route28MiB/180秒，普通边界/认证/Host/Origin不扩大。页面验收用户负责，不宣称浏览器效果已验。
