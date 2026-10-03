# 验证 · 0017 声音理解

当前本机前端324项全量与语法通过，日志保存在工作区`.tools/sound-library-verification/frontend-final.log`及`frontend-syntax.log`。保留旧299项断言，49个构建输入已绑定；新增独立模块、实际DOM、原文件与API、两个精确代理的行为验证。

用户路径已接通：显式选择声音理解→只保存完整原声音→刷新授权列表并打开详情→显式建立全部窗口声音索引→完整selected/all声音问答→核对事实SHA与服务器样本窗口→校验完整原音频SHA后播放、按窗口seek/stop和下载。reader只读，整理草稿保留，停止等待后显示结果未知并要求显式刷新。纯声音来源注册版本可预览，已发布声音不会误触发旧转录向量或摘要入口；原音频转录模式保留。

红绿证据：新模块9个断言、实际DOM初始3个断言、注册版本预览、完整能力门禁和独立发布入口均有真实失败及对应GREEN。代理6项使用只读0027源码副本验证缺路由失败，然后当前两个代理通过；首次external夹具漏响应导致启动失败，不计行为RED，纠正记录单列。新入口只有精确sound upload转发一次编码X-Filename；普通JSON128KiB、查询附件28MiB、原声音20MiB和既有身份边界保留。

独立产品审查发现P2：合法原facts累计8192字节时，canonical JSON转义和16条LF连接增加字节，原前端误拒。新增2项行为测试，旧实现实际1项assertion RED；修复后本组12项GREEN并完整324项通过。facts按原UTF8累计限长，SHA仍绑定完整canonical JSON；answer允许8192+15个LF字节，8193字节facts/8208字节answer仍拒绝，没有截断或放宽后端原事实预算。

后端0028完整2268 Java、787格式与原双80%门禁通过，真实Spring/SQLite/FFmpeg声音链与旧四项Native已通过，包含实际440/880Hz音调、静音和尾部差异；803后端/49前端输入未变，586个生产class与最终JAR一致。交接入口为工作区`.tools/sound-library-handoff`，冻结与独立审计以实际manifest/validation/sidecar为准。本切未部署或进行网页验收。替身测试不认证真实声音/ASR语义质量。用户自行验收页面；主线目标继续active，随后推进原视频音画检索。
