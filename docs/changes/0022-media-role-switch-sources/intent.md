# Intent：模型切换后旧视觉来源能打开

状态：LOCAL_VERIFIED。后端0034把媒体生成可用性与已保存来源纯读分开。已有视觉答案的metadata和原图通过原校验后，能在visual_sources有效时打开；不能因新视觉问答关闭而拒绝旧原图。实际本机结果见verification，未部署。

仅修app.js现有canReadImage视觉回调，保留新问答、完整SHA/来源、当前身份与迟到响应保护；不增加模型配置、历史列表或其他功能。网页由用户验收，不访问真实页面/provider/部署。
