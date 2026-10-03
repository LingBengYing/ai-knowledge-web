# 0016 原声向量入口验证

2026-10-03，配套后端0027，独立音频向量Session和真实app DOM/精确代理通过本机完整回归。网页由用户验收，本轮没有浏览器操作、真实模型调用或部署。最终源码与制品绑定以工作区`.tools/audio-vector-retrieval-verification/backend-final-evidence.json`和新handoff的`VALIDATION.json`为准。

## 行为

实际audio_vector_retrieval/audio_answers/audio_sources能力、真实indexed audio及当前source/publication身份合格才GET十字段状态。当前编辑者查看全部可引用语音分段调用和费用说明后显式bodyless POST，reader按钮禁用，已就绪receipt不重复POST。音频Session独立于原图/摘要/原文件；双能力同时启用时只显示对应资料类型的面板，刷新保持同一整理form和未保存输入。

忙碌防重复，身份/资料/权限/离页变化使旧结果失效。停止只取消本地等待，明确服务器结果未知且不可再次建立；用户显式GET刷新后才恢复判断，不自动POST或重试。当前AUDIO模式携音频沿既有完整selected/all scope附件流程；缺scope receipt明确提示给范围全部音频建立原声向量。答案只打开库内转录/原音频SHA及服务器时间来源，参考音频和向量不成为引用。

开发和外部代理仅精确GET/POST `/v1/documents/{id}/audio-vector`，禁止query/body、错误method/路径和encoded分隔符；仅POST180秒，GET及普通JSON期限保持。新module资产按精确路径服务，原认证、Origin/Host/Cookie/JSON/上传预算和无自动重试合同不变。

## 红绿与实际回归

- 新`audio-vectors.test.mjs`7项：先落可执行导出stub，实际RED7项均ERR_ASSERTION，模块不存在或编译失败不计RED；实现后7项全通过。覆盖真实音频/能力、精确GET、显式editor POST/reader、十字段绑定及3072维边界、重复与profile漂移、身份/权限迟到、关闭和认证失败。
- 真实app DOM新增3项，原58项保留。RED为61项58pass/3fail，其中前两项是缺面板的断言失败，第三项因缺按钮产生TypeError，不计独立行为RED。接通后连同module共68项通过。初次接通有1项新成本说明措辞与测试不一致，日志`audio-vectors-app-green.log`保留67pass/1fail；产品说明改为明确“将调用”且保留全部分段和费用后，完整回归通过，没有删断言求绿。
- 两代理新增各1项，RED75项73pass/2fail，接通后75项全过；检查GET/POST独立期限和精确权限/传输边界。
- 最终`npm run check`通过；`npm test`299项=原287+新增12，失败/取消/跳过均0。后端Node73项另单列通过。实际记录为工作区验证目录`frontend-syntax.log`、`frontend-final.log`、`backend-node.log`及保留的全部audio-vectors红绿日志。

## 限制

仅合成本机HTTP/DOM与后端真实Spring/FFmpeg正常链，模型/Milvus均loopback协议替身；它们不证明真实原声语义召回或ASR质量。当前部署仍20261003-voice-tags，不含新原图/原声向量；页面完整业务验收由用户负责。默认开关关闭，新构建由部署责任方配置独立模型/decoder profile与java_audio集合并按v18备份迁移，主线没有读取凭据、Git写入或旧服务器/数据操作，usage/计费取消。

## 最终构建绑定

后端2026-10-03 06:01:04+08最终clean verify为2042/0/0/0、716格式、LINE93.068059896441%/BRANCH80.306962259954%；原1913用例身份多重性保持。collector复核732后端/46前端输入无变，529单列native生产类等于最终target/JAR。JAR SHA为`1a354f2a984950715818b02bdf03170b6ebaeb7e2ba6145a1bb62bc5595a393b`，38,933,745字节。最终门禁与源码绑定为实际记录，首轮coverage失败和合并preflight预测分别保留。新handoff冻结与独立工件审计单独记录，不代表部署。
