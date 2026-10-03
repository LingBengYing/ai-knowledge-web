# 行为合同

- QW-01：`query_attachments` 与所选证据模式的 answers/sources 均启用、身份连接成功时允许添加；未启用显示原因，旧纯文字请求可继续。
- QW-02：最多3个非空原始文件，总原字节20MiB。图片PNG/JPEG；音频WAV/MP3/FLAC/OGG/M4A/MP4/WebM；视频MP4/MOV/WebM/MKV。显式选择附件类型消除MP4/WebM歧义。图片仍遵守既有10MiB编译上限。校验整个新增批次再接受，不静默丢弃附件。文件仅当前页内存持有，切换身份/离开问答/关闭页面释放选择。
- QW-03：提交前校验原问题及完整scope；原问题不trim、不改写，显式空scope保持空。附件以原文件名、合同MIME及完整base64发送到精确POST `/v1/attachment-answers`。模式映射为text/image/audio/video_visual/video_transcript/video_joint/video_ocr/video_subtitle，代表库内证据类型。无附件仍发旧四入口和旧JSON。
- QW-04：从附件读取开始就防重复；取消、身份/范围/模式/问题/附件变更使读取和响应失效；失效读取不得发请求，写操作不重试。附件不自动导入资料库。
- QW-05：校验响应mode及逐项ordinal/media_kind/status/visual_sampled/reason，再按原typed答案校验器验证result。展示已处理/失败/视觉采样说明及拒答原因；所有文本为textContent，附件不生成引用。库内来源仍使用原精确URL和身份/SHA校验。
- QW-06：两个代理仅新增精确POST附件入口和静态Module，拒绝query及错误方法/类型；该入口独享28MiB请求、180秒总期限、最多2个在途，响应仍4MiB。原JSON128KiB、普通10秒、资料上传20MiB/30秒、Host/Origin/认证边界不变。

本地必要验证覆盖正常图片/音频/视频编码、八种模式映射、完整scope、拒答与来源回读、取消读取、防重复、能力关闭、批次限额和两个真实HTTP代理。浏览器和真实provider质量标为未执行，不能用替身认证生产。
