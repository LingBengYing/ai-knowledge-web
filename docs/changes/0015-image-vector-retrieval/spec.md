# 合同

- IM-01：仅image_vector_retrieval与原图问答能力有效，资料为indexed图片且当前owner/editor时可显式POST精确/v1/documents/{id}/image-vector（无query/body）；reader只GET当前结果，不启动构建。
- IM-02：独立Session核对十字段和当前document/publication/source/profile身份，显示missing/available；点击构建前明确将调用所配置图片embedding。保留整理草稿，防重复，无自动重试。
- IM-03：换资料、身份、详情关闭和离页使读取/构建迟到结果失效；取消仅停止本地等待，不宣称撤回上游。精确POST独享180秒，GET普通期限，普通JSON/认证/Origin/Host限额保持。
- IM-04：参考图沿现有查询附件与原图模式，文字问题/完整scope保持，页面提示先建立范围内图片向量。向量不能成为事实或引用，来源仍原库图及完整SHA。能力关闭旧行为保持。

本机Session/实际app DOM/代理HTTP不认证浏览器、真实图片语义召回或部署。
