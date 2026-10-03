# 0015 验证记录

2026-10-03本机实现后端0026配套原图向量入口：已indexed图片详情读取当前结果→当前编辑者显式构建→原图模式添加参考图→服务器完整范围检索及原库图证明→原来源。默认关闭，无自动补建。当前完整网页由用户验收，本增量未部署；实际现网20261003-voice-tags已含标签/语音，部署结果及只读入口已核对，真实ASR失败保留。

## 实际红绿

- 独立ImageVectorSession首次7项失败，`image-vectors-module-red.log`；实现后7项通过。初稿夹具将资料status误填indexed，按真实合同修正为status=parsed/index_status=indexed，并保留`image-vectors-module-green-final.log`。夹具纠正不算产品修复。
- 实际app DOM初次55通过/2失败，`image-vectors-app-red.log`；独立面板接入后读取/构建保留草稿，reader只读与离页迟到隔离通过。
- 两个实际Node代理HTTP初次71通过/2失败，`image-vectors-proxy-red.log`；精确无query/body GET/POST、仅POST独享180秒、模块静态白名单接入后通过。
- 独立交叉复核发现停止本地等待时文案错误地称“尚未建立”。新增实际DOM用例形成1失败、0错误RED，`image-vectors-cancel-red.log`；修正为未知状态、服务器可能仍处理，必须显式刷新后才能再次构建，`image-vectors-cancel-green.log`为1通过。没有自动重发POST。
- 整合相关137项通过，`image-vectors-integration-green.log`。最终完整`npm test`为287项、0失败，`image-vectors-final-full2.log`；`npm run check`语法通过，`image-vectors-final-syntax.log`。44个前端源码/测试/脚本输入在最终完整验证前后字节相同。

前端日志归档于工作区`.tools/image-vector-retrieval-handoff/logs/`；哈希及后端配套实际全量/native结果见该包`VALIDATION.json`和后端0026验证。初期失败日志保留，不改写为通过。

## 合同与复核

IM-01覆盖实际capability、PNG/JPEG/10MiB、parsed+indexed、完整发布身份与编辑权限；reader只能读取。IM-02覆盖严格十字段包络、missing/available、GET→POST固定profile/model/dimensions及整理草稿保留；available不再发构建。IM-03覆盖忙碌防重、身份/资料/离页迟到失效、停止后仅刷新、401回调，以及两个精确代理的无query/body和认证边界。IM-04接既有参考图附件与原图模式提示，不改原文字问题、完整scope或库内来源。AnswerSession接受合法服务器拒答reason，image_vector_required在app有明确说明。

pdf_config只读复核前端捕获取消文案问题并由root修复；pdf_ingestion补测后独立复核IV07–09及前端模式/拒答/状态生命周期，未发现主线缺陷。未运行浏览器、部署环境或真实模型。

## 交接与边界

产品补丁仅public/image-vectors.mjs、public/app.js、public/index.html、scripts/dev-server.mjs、scripts/external-server.mjs五文件；基线为已冻结voice-questions-handoff。dry-run只认证该主线基线，现网open-access及server/index定制须由部署责任方合并保留，不能整包覆盖。

本机DOM/Module/HTTP和生产Java/native链使用合成资料及loopback模型/Milvus协议替身，不能认证真实图片语义召回、真实provider/Milvus、网页或生产完成。本轮真实/付费调用0、无Git索引/服务器/私有env/旧数据操作；usage/计费取消。开发总目标继续active，后续音频向量及真实质量/发布验收保留。
