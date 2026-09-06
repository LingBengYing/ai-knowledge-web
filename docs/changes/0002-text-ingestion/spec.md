# Spec

1. 仅当Java capabilities同时含`text_upload`和`ingestions`时开启上传。用户选择1..20MiB的pdf/txt/md，文件名编码为唯一filename参数，以application/octet-stream发送原始File；202仅表示任务已创建。
2. 显示当前任务安全字段、attempt和queued/processing/parsed/failed/cancelled；parsed明确未索引。取消/重试取决于服务器can_cancel/can_retry，重试不超过3次attempt，不自动重试写请求。
3. 单任务约1.5秒轮询，terminal停止；身份/分页/筛选变化清空任务、定时器和旧读取票据。旧身份、旧任务或旧attempt结果不能回填；失败清晰展示，不暴露正文、凭据、原始异常。
4. 开发代理只为POST `/v1/documents?filename=...`扩大至20MiB/30秒，最多两个上传exchange在途（超出429）；现有JSON仍128KiB/10秒，header仍10秒、上游响应仍4MiB。deadline包括接收请求和读完上游响应，不包含慢浏览器排空。仅新增精确task GET与cancel/retry POST，无请求体。Host、Origin、Authorization拒绝、Cookie限域与重定向禁用不放宽。
5. 两仓库六静态文件显式同步，新来源记录不沿用旧哈希认证。保留43项基线并增加上传、任务异步状态和代理限额测试；真实Java/浏览器由负责人独立验收。
