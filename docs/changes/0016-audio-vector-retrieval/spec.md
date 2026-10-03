# 合同

- AU-01：实际audio_vector_retrieval/audio_answers/audio_sources capability与indexed真实audio时独立GET状态，当前editor明确成本后才bodyless POST精确audio-vector；reader只GET。
- AU-02：十字段精确绑定当前document/publication/source与模型/投影/dimensions；missing才允许构建，available不重复POST，保存整理草稿。
- AU-03：忙碌防重复、身份/资料/离页迟到失效；停止仅本地等待，服务器可能仍处理，须显式刷新，无自动重试。只有精确POST获得180秒，GET及普通JSON/认证预算不扩大。
- AU-04：原AUDIO+参考音频沿现有附件，完整scope/问题保持，audio_vector_required提示给范围全部音频建立向量。向量/参考音频不作引用，来源仍服务器原转录与音频SHA/时间Range。真实语义/ASR/浏览器及发布另验。
