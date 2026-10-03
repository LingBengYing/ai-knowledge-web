# REVIEW：0021范围与安全例外

2026-10-03，开工合同审查。已读后端 [0032 intent](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/intent.md)、[spec](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/spec.md)、[plan](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/plan.md)、[REVIEW](../../../../ai-knowledge/docs/changes/0032-model-setup-retrieval-test/REVIEW.md)。状态为隔离草稿，尚未实施到产品、未执行本切测试。

批准的窄例外：旧AGENTS中“不在浏览器内放 provider key”针对持久暴露与前端持有模型凭据；用户现在明确要求从设置填写三个硅基流动角色的只写密钥，0032已冻结写入合同。故允许密钥短暂存在于password输入控件与一次同源PUT传输，不允许浏览器持久存储、Session公开状态、GET回显、日志/截图/错误、代理自管凭据或浏览器直接调用模型。提交、离页、身份变化和401清空。此例外不要求重复向用户申请已批准开发权限。

边界：只按实际 capability 和安全 `can_edit` 呈现，Java仍负责组织模型管理员/完整scope/最终权限；旧文档can_edit不能推导配置权限。保存、测试、应用明确分离；无自动重发、无自动模型调用、无自动索引、无声称重建已实现。召回排序不作事实证明，文本/文件名不执行HTML。

实际代理文件、接口安全field/error_code细节由当前源码及A/B公开类型继续核对；合同如有矛盾先协调，不自行新增端点/字段。产品与旧断言保持；本切不部署/浏览器/真实模型/Milvus/凭据读取，usage/计费取消。

2026-10-03后续实际整合：已按后端冻结interfaces附加安全可选ApiError.errorCode/field，旧构造/status/message保持。两个Session及实际页面/代理/测试13文件先在隔离草稿实现；首轮相关184项中2项失败为草稿静态资源Map误改与缺复制登录资源，均修正且原断言不变。syntax首次缺deployment-tests目录是隔离输入不完整，补复制只读原测试源码后通过，未执行部署测试。上述首次日志均保留，不当作原基线功能RED。

最终草稿420/420、0skip与syntax通过，CLT路径在每条Node命令PATH首位。26新增行为覆盖显式save/test/apply、write-only清空、未知结果只读确认、reader、身份/版本迟到、真实DOM完整scope召回、同版本原文件全SHA及代理精确方法/期限。主代理已明确开放前端源码；13文件正式整合后逐字节匹配验证草稿。工作区证据为`frontend-draft-ready-c.json`（SHA `933b3914e11e23252b51171680b5813c8d5e905c3aa5fd6e6f9de92678675ead`）与`frontend-integration-c.json`（SHA `8007f9cc988b07791fa5fd9ff07ad0cb4be69aa63609bd7377a479ba4b592f78`），均位于`.tools/model-configuration-preparation`。正式输入最终门禁待协调方，不以草稿通过宣称浏览器、真实供应商或部署完成。

2026-10-03后续实际正式验证：协调方批准应用后只读刷新授权资料列表，使用preserveDetail保留真实整理表单、原问题与完整范围；身份改变后迟到回读不加载旧资料。新增2个DOM用例，正式合计422项。C正式第二轮及根代理独立正式轮均422通过、0失败/跳过；根代理64输入before/after字节相同，已只读确认根syntax日志通过。旧0031的394个成功case名称多重集完整保留，新28项。首轮补充的2个新DOM失败、原因与最窄修复记录见[verification](verification.md)，原断言保持，首日志未覆盖。

本阶段仅证明本机前端行为与精确代理合同；没有部署、浏览器或真实供应商通过声明。用户逐步操作说明见[模型设置与召回测试](../../MODEL_SETUP_AND_RETRIEVAL.md)。向量库显示configured或只读连接通过均不冒充schema验证，409不兼容保留旧active且没有伪重建按钮。

2026-10-03基础流程只读复核确认并获根代理授权窄修：成功刷新已保存配置必须同时放弃未保存字段和密钥，不能显示新密钥而测试旧保存版本。3条新实际DOM回归先有1个有效RED；修复限定在当前serial及合法GET校验之后，仅已有安全configuration的刷新清密钥。失败GET保留草稿/未知写入，换身份和停止后的迟到响应不能清新输入。首次完整425中的旧清理次数断言失败已保留，最窄生产限定后425全部通过，旧422多重性完整保留，64输入前后相等、syntax通过；详细日志与SHA见[verification](verification.md)。没有修改旧断言、后端、代理、部署或浏览器状态。

2026-10-03另一获授权基础状态窄修：role重测开始即清该role上次结果，不清其他角色；停止/超时和迟到响应不再沿用旧通过。新增2条实际DOM先2失败，最终427全部通过、原425多重性完整保留、64输入前后一致、syntax通过。只改原模型Session和追加DOM用例，所有前态与失败日志保留，未扩展功能或修改后端/代理。

2026-10-03获授权恢复修复：服务器已应用但响应丢失时，显式读取active后须同步实际capabilities与授权列表，不能只确认版本而保留首次无索引/召回能力。app只在当前epoch/身份/设置页有效时复用原只读refreshModelCapabilities及preserveDetail，不重发写入。3条实际DOM先1通过/2失败，最终430全过、原427多重性保留、64输入相同、syntax通过。未修改后端/代理、旧断言或真实服务，具体证据见verification。
