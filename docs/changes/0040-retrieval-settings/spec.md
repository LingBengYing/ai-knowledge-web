# Spec

设置页独立检索卡片：vector/full_text/hybrid、weighted/rerank、dense_weight、TopK、阈值开关和值，展示当前生效嵌入/重排模型并跳到既有模型配置。采用后端0054 GET/PUT /v1/retrieval-settings完整7字段+version合同；冲突要求重读，不自动覆盖。

召回测试默认继承，完整retrieval_settings临时覆盖无version，响应effective_settings同GET，configuration_version仍是模型版本。临时覆盖不自动存储、不带入正式问答。展示实际score_kind与重排分，不称置信度；该测试目前只覆盖文字/OCR，不能冒充视频混合预览。

设置保存不触发模型测试/应用/重建。范围固定全库，保留模型秘密保护、迟到响应隔离、来源校验和不自动重试。只本地实现及验证，旧线上不改。
