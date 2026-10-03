# Verification：模型设置与独立召回页面

2026-10-03。前端实际实现已整合并完成本机回归；后端0032最终整合、真实供应商、浏览器和部署验收分别记录，不由本文件代替。操作说明见[页面验收流程](../../MODEL_SETUP_AND_RETRIEVAL.md)。

## 已验证范围

- 设置独立Module及实际DOM：严格安全九字段，三个角色、只写密钥、留空保留、保存/测试/应用分离、reader只读、未保存编辑使旧测试失效、版本与身份迟到隔离、停止或断网结果未知后仅GET确认。
- 应用成功后只读刷新安全能力和当前授权资料列表，保留真实详情表单DOM、整理草稿、完整问题和范围；不自动创建索引。身份改变后的迟到能力回读不重新加载旧身份资料。
- 召回独立Module及实际DOM：完整scope、显式空范围、原问题、RRF/重排分解释、全文SHA与Unicode码点定位、错误尾项整批拒绝、取消与迟到隔离、生成/答案请求不自动触发。
- 同版本原文件：复核document/revision/filename/source SHA，复用既有原文件Module再次读取完整字节并校验SHA后才提供打开/下载链接；不伪造答案source URL。继续问答保留原问题与完整范围，仍需明确点击发起。
- 两代理仅增加精确设置和召回路由；query包括空问号、额外路径、错误方法、非JSON拒绝；普通设置10秒、单角色测试70秒、召回180秒及原128KiB/4MiB限额单独绑定，身份和Origin边界保持。

## 实际执行

每条Node命令的PATH均以`/Library/Developer/CommandLineTools/usr/bin`开头，随后为`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`。没有运行Maven、浏览器或部署脚本。

| 执行 | 实际结果 | 工作区证据 |
| --- | --- | --- |
| C最终隔离草稿 `npm test` / `npm run check` | 420通过、0失败/跳过；syntax通过 | `.tools/model-configuration-preparation/frontend-draft-full-final.log`、`frontend-draft-check-final.log` |
| C应用后刷新补充 `npm test` | 422通过、0失败/跳过 | `.tools/model-configuration-preparation/frontend-formal-full-second.log`，SHA `ca896fe10cf47185ad329159c35cff93fb94035b73cfa900941e49efb70784df` |
| 根代理正式输入 `npm test` | 422通过、0失败/跳过，64个输入before/after相同 | `.tools/model-configuration-preparation/frontend-root-test-first.log`，SHA `2e362c6249a3c58692db56b3038982c488e3822e2b30bff174e733ded50a209a` |
| 根代理 `npm run check` | 已读到`JavaScript syntax checks passed.` | `.tools/model-configuration-preparation/frontend-root-check-first.log`，SHA `6c1661f147f54c17396bdacbf3a2bdfab5184b719a7ea08cecaa7d8919676408` |

根代理结果文件`frontend-root-test-first-result.json` SHA为`8d4f0b078ae6dffaf4d3593bea119fcd7f1fc1be16c241bcf120a748e56e8e38`。64输入的before与after JSON位于`.tools/document-cleanup-verification/frontend-inputs-model-setup-before.json`和`frontend-inputs-model-setup-first-after.json`，两者SHA均为`23b46a61703bf4085dfa82c5e77ac0754230e232869953f23c2ea49b74543e23`。

本次只读比较0031根代理完整日志`frontend-coordinator-first-full.log`与本次根代理完整日志的成功case名称多重集：旧394项全部保留，缺失0，新28项。新增为Module15、DOM6、API1、代理6。旧断言不删除、不跳过、不放宽；原DOM harness仅增加实际新模块和公开函数装配。

## 首次结果保留

隔离草稿首轮184相关用例为182通过、2失败：一个新增替换误改原静态资源Map，一处隔离目录未复制原登录资源；已修产品草稿/补齐未改的资源，原断言保持。syntax第一次缺隔离`deployment-tests`目录，补齐原测试源码后通过，未运行部署测试。日志保留在`frontend-draft-related-initial.log`、`frontend-draft-check-second.log`。

应用后刷新补充的首次正式422用例为420通过、2失败。新DOM夹具暴露重新创建API适配器绕过当前请求上下文；已改为身份核对后只更新同一受信配置对象的capabilities，再只读刷新列表。原上下文与合成请求适配器保留，两个新断言保持。首轮`frontend-formal-full-first.log` SHA `10b8adc1214ec69f6035261290c999f04a3df8380bb38fe3c2727f2a2a266e52`未覆盖。这些记录不冒称当前后端路由的真实业务RED。

## 成功刷新密钥草稿的窄修复

2026-10-03后续页面核对发现：在已保存配置上填新密钥后，成功读取同版本会清dirty却留下密码输入，导致页面允许测试服务器旧密钥。新增真实DOM用例先取得3项中1失败、2通过的RED（`frontend-refresh-fix-red.log`，SHA `f640c404192f1b461e957576f33ba236ceb171e4cee43e9d74f9329aee9ffb1d`）。最窄修复只在当前serial通过、合法GET返回且已有安全configuration时清理密码输入；首次加载、失败GET、未知写入与迟到隔离保持。

首次完整425项为424通过、1失败，原因是最初无条件load清理使旧“首次保存前恰好清理一次”断言失败；现限定已有配置的成功刷新，旧用例和断言不改。该日志`frontend-refresh-fix-full.log` SHA `ae21ec18e2355636177bbc2da27f7286fe11c586d750a1706cfeef7975ad3aa8`保留，不覆盖。

C最终`npm test`为425通过、0失败/跳过，`npm run check`通过；均使用上述CLT首位PATH。64个完整输入before/after相等，旧422个case名称多重集完整保留，新3个DOM覆盖成功放弃未保存字段/密钥、读取失败与未知写入、换身份或停止后迟到结果不清新输入。证据位于`.tools/model-configuration-preparation/frontend-refresh-fix-ready-c.json`，SHA `ba97a9ad1979e9c953248266baee4bac70289e02ffb7511d369ca3f1efe4f8d1`；最终日志`frontend-refresh-fix-full-second.log` SHA `58f7debb11b47d23582a2134dfe02f4b42e4222c9e3429bb61a19b19637825e5`，check日志`frontend-refresh-fix-check-second.log` SHA `6c1661f147f54c17396bdacbf3a2bdfab5184b719a7ea08cecaa7d8919676408`。后续根代理独立执行另记，不以本轮声明已部署或真实连接通过。

## 角色重测状态的窄修复

2026-10-03角色重测状态另一次最窄修复：开始新的显式role测试时只清该role旧结果，其他角色结果保留。2条新实际DOM操作先得到2失败RED，证明旧通过会留在新等待/超时后；修后覆盖停止、超时及迟到响应不恢复旧通过。最终C完整427通过、0失败/跳过，syntax通过，旧425个case（含前述3个刷新case）多重集完整保留；64输入before/after SHA均为`c476b51b0f74b5e237df39b7eb11265a7e2a31c271d8b4ea46a3d573987a635a`。证据`.tools/model-configuration-preparation/frontend-retest-fix-ready-c.json` SHA `43086ea9e2089f68519c6dcb2d94fe68f2f41f359222a98947269726e8b6d7d9`；RED日志`frontend-retest-fix-red.log` SHA `f112374a083a2948cf4b3598e1a631389ca25e6b8dd9f8dea0d8c8a4e0fb725e`，完整日志`frontend-retest-fix-full.log` SHA `2ad3f6e0b947ee58d32b9481d068ff7c3c850b09ce6d8a06e33174686427521b`。原断言及其它产品路径保持，根代理独立最终执行另记。

## 应用响应丢失后的能力恢复

2026-10-03基础操作复核发现，服务器已应用但响应丢失后，原“读取当前配置”仅确认版本，没有同步首次未配置的capabilities，导致索引/召回继续不可用。3条新实际DOM先取得1通过、2失败RED。现在仅在用户显式读取成功且存在active version、原epoch/身份/设置页仍有效时，复用应用成功的只读能力与preserveDetail资料回读；模型状态或能力的迟到响应均不能恢复旧身份。没有重发保存、应用、测试或索引。

C最终430通过、0失败/跳过，syntax通过；原427用例名称多重集完整保留，64个输入before/after SHA均为`058e7ec0ca3df74ef406814258bca4693ed2160b6069db4c5676f294557d54f4`。只改app读取按钮并追加3个DOM，harness仅增加真实未配置capabilities设置。证据`.tools/model-configuration-preparation/frontend-recovery-fix-ready-c.json` SHA `0c937bc14dfefca67ecf912c1970cc77596de353cb2dd72199e858b9d1a4a8d4`；RED日志`frontend-recovery-fix-red.log` SHA `f36eb7a63bfb8b02617ad53a1a69ca553afe339284bfa6123296bba8640c8799`，完整日志`frontend-recovery-fix-full.log` SHA `f03160922d83bc76d8288dc5ad6929cdfd3c42a7e2945af4c60a4fee99a5a82d`。旧断言保持，根代理独立验证另记。

## 未验证边界

没有真实硅基流动或Milvus调用，没有浏览器/当前部署验收，没有发布。模型测试的本机HTTP替身只能验证协议和调用路径；实际供应商权限、费用、质量及真实向量库schema由后端与用户页面验收分别确认。Milvus配置齐全或只读连接测试通过不等于已验证集合schema，也不代表已建索引。409 `model_rebuild_required` 保留旧active，本切没有重建按钮。usage/计费仍取消。

根代理最终独立复跑：`npm test`实际427 PASS、0fail/cancel/skip，`npm run check`实际PASS，64输入before/after相同。旧422成功case名称多重集完整保留，新增5项DOM操作回归分别覆盖刷新密钥及重测失效结果；C两次有效RED和首次425/1fail记录保持只读。实际结果文件为工作区`.tools/model-configuration-preparation/frontend-root-final-result.json`，测试日志SHA46d6f038bbe1000ba30a46fa5bbe6e80e6483e3960b8e69c6a82e0fed607f19a，syntax日志SHA6c1661f147f54c17396bdacbf3a2bdfab5184b719a7ea08cecaa7d8919676408。后端完整门禁及部署/用户页面验收仍分别记录，不以本机DOM代替。

后端最终3011Java/1004格式/原双80%/六Native各1与完整759class/JAR绑定均PASS，实际日志和保留失败见后端0032验证。root独立前端430/check PASS、64执行输入相同，旧冻结370case直接多重集完整保留；最终交接以model-setup-handoff manifest/VALIDATION实际为准。本机通过不代表真实模型、页面或已部署通过。
