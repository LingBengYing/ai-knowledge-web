# Spec：重建入口、状态与版本回读

状态：LOCAL_VERIFIED；本机实施和实际回归通过，未部署。当前证据见[verification](verification.md)。下方设计及早期记录保留历史语境。

1. 新独立行/详情“重建文本索引”要求已连接、text_index/indexings/text_reindex及当前行can_reindex=true；保留“索引任务”。不拿can_index或can_answer代替资格。当前base publication和parsed revision合法且无pending；server拒绝仍直接显示，不过滤或自动重试。
2. 确认说明会调用嵌入及向量服务、旧版本执行期间继续使用。取消确认零请求；确认捕获document/base/identity epoch，发送精确POST /v1/documents/{id}/reindex及JSON {base_publication_id}，无query，原10秒/128KiB普通限额。不暗中更改模型配置或解析/ASR。
3. 202沿原新任务watch、取消/最多三次retry；原任务不回队。任务与当前active独立展示。processing、failed、cancelled不能声称旧索引消失；后两者明确“本次未发布，旧版本继续使用”。任务返回不能自行发布active。
4. 终态回读授权document并比较publication_id，parsed revision可能相同。成功实际新publication后清除旧来源预览及迟到结果、说明重新查询，保留问题、scope及未保存整理字段。读取失败不伪造新版本。失败/取消回读仍旧base，不清除仍current来源。
5. 服务器can_reindex/cap变化及时更新入口。现有独立image/audio receipt和standalone sound/video-av不属于本首切，不显示入口；不得篡改receipt或掩盖不可用。后续migration/full reindex范围保留。

同一详情建立图片/音频向量后，Session完整身份已验证的同document/publication available receipt可暂时收紧当前重建入口，并提示刷新资料；不改写服务器can_reindex，不扩大到别的资料或旧publication，也不自动请求管理列表或再次建立。行/详情及此前捕获的确认都必须即时遵守该条件。原两次GET/POST、草稿与迟到隔离保持。

旧435用例身份/断言保留；新增实际DOM和严格transport/proxy断言先原产品业务RED，同源码GREEN后完整check/test。真实页面及部署NOT_RUN。
