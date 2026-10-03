# Verification：语音提问网页

2026-10-03本机实现与验证。现有音频文件经显式转录、完整文字预览、用户编辑确认后，作为问题进入既有库内问答与来源回读。本轮开发与验证的真实模型及付费调用均为0；没有浏览器访问、部署或Git写入，页面由用户验收。

## RED与必要夹具修正

- VoiceQuestionSession：先以可执行的最小stub运行`node --test ui-tests/voice-question.test.mjs`，10项均因业务行为未实现而失败，失败/取消/跳过分别为10/0/0；没有把模块不存在或导入失败算作RED。日志`.local/voice-question-module-red.log`。
- 真实app DOM：共54项，51通过、3失败。新增两项分别在语音控件缺失处失败；另一个既有摘要来源用例在仍显示“回读中”时未得到“打开原文件”，该次时序失败不作确定性原因诊断，也不计作语音功能RED。对照0013冻结源，该旧用例主体和断言未改。日志`.local/voice-question-app-red.log`。
- 两个Node代理：既有67项通过，新增精确静态资源/POST传输、独立期限与两个在途名额相关4项失败，共71项、4失败、0取消/跳过。新路由当时返回404，未满足预期200/429。日志`.local/voice-question-proxy-red.log`。
- Session首次实现后9/10通过，余下一项来自新增文件名夹具：原生File已把孤立surrogate转换为替代字符，未实际向校验器提供预期的非法名字。仅修正新增夹具使其保留非法name属性，保留原拒绝断言；此夹具错误不算产品RED。过程日志`.local/voice-question-module-green.log`，最终10/10记录见`.local/voice-question-module-green-final.log`。
- 代理首次实现后70/71通过。新增外部代理期限用例把普通请求发往`/v1/config`，而既有fixture会立即返回200，未进入所设的延迟响应；因此预期504的断言无效。仅将新用例的普通请求改为`/v1/management/tags`，保持期限、状态及调用次数断言和全部旧断言。`.local/voice-question-proxy-green.log`保留这次70/71结果，文件名不表示全部通过；修正后证据在定向与全量日志。
- 第三个DOM用例“非法文件变化及证据模式变化丢弃未确认预览”为实现后的增补覆盖，没有独立RED，不与此前两项RED混算。

## 最终GREEN

- Session单独10/10通过，失败/取消/跳过均0；日志`.local/voice-question-module-green-final.log`。
- 相关定向执行`node --test ui-tests/voice-question.test.mjs ui-tests/task-detail.test.mjs tests/dev-server.test.mjs tests/external-server.test.mjs`：Session 10项、当时app DOM 54项、两代理71项，共135项全部通过，失败/取消/跳过均0；日志`.local/voice-question-targeted-first.log`。此前失败的既有摘要来源用例在原断言下通过。
- `npm run check`通过；日志`.local/voice-question-syntax.log`。
- `npm test`执行完整既有命令`node --test ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs`：275项全部通过，失败/取消/跳过均0。相对0013的258项，新增17项为Session 10项、app DOM 3项、两个代理4项；最终app DOM共55项。root完成两次275项全量通过，`.local/voice-question-full.log`保留最新一次GREEN；该次运行前捕获42个前端输入文件作为源码绑定补验口径，不是测试数量。

没有删除、跳过或放宽既有有效断言以取得GREEN。本验证文档仅依据上述日志、当前测试及限定只读差异核对编写，未为文档更新重跑测试。

## 合同覆盖与交叉复核

| 合同 | 已验证行为 |
| --- | --- |
| VW-01 | 独立voice_questions能力门禁，不依赖query_attachments；音频类型、名字、非空与20MiB限制在读取前校验；能力关闭不读取文件。 |
| VW-02 | 显式转录只发送filename/media_type/content_base64；完整原字节与canonical base64一致；响应精确8字段、固定policy、版本/时长、原SHA及完整转录SHA均校验。保留尾部文字及UTF8最多65536字节的完整预览。 |
| VW-03 | 预览和编辑不调用问答、不覆盖手工问题；明确确认才按原4096 UTF8字节限制填入问题。随后走既有AnswerSession，发送完整所选范围，包括未发布项；只回读库内引用。语音不自动成为检索附件，不自动切换为音频证据模式。 |
| VW-04 | 重复转录不重发；读取中取消/换文件/能力变化不发送迟到上传；reset后的转录不恢复旧预览。转录与问答互斥，范围、问题、模式及离页使旧结果失效；401沿既有身份处理，错误不自动重试，非法文件变化清除未确认预览。 |
| VW-05 | 两个真实本机Node HTTP代理只允许精确模块与无query的POST路由；语音JSON容量、期限、两个在途名额独立，普通JSON容量/期限保持。已有认证、Host/Origin、附件、问答及来源回读回归继续通过。 |

pdf_config对本轮Session与实际app/index、两个代理增量进行了限定静态交叉复核，未发现阻断问题：canUseVoice只检查外部连接/能力/当前模式与问答忙碌状态；确认保留scope/mode及既有附件集合；问题编辑、openAnswers、模式变化、离开问答、resetContext和pagehide均清理语音状态。预览输入后仅在值不同时回写textarea，避免每次输入重置caret；文件错误与取消有反馈，取消文案明确只停止本地等待。这些静态核对不冒充浏览器验收。

## 交付与未验证边界

当前0014为本地已验证增量，尚未部署。按当前部署交接信息，现网仍为PDF切片，不含0013摘要建议标签及0014语音提问；不得把275项通过写成线上功能已可用。后续交接须保留现网open-access定制，不整包覆盖独立部署副本，既有冻结包保持不变。

本轮使用合成文件/协议响应、实际app的DOM Adapter和本机代理HTTP验证，不证明真实ASR识别质量、浏览器布局/媒体行为或公网闭环。后端0025的真实解码、原始分段转录完整性与服务预算由后端验证记录单列，前端响应夹具不替代这些证据。产品启用后，用户点击转录会调用服务器配置的模型；开发测试0次付费调用不代表实际使用没有模型调用或费用。

页面仍由用户自行验收：语音上传→完整转录预览→编辑并明确确认→按原范围/模式提问→打开库内来源，以及取消、换文件和离页反馈。本轮未访问用户页面，也未把历史截图、本机DOM或loopback通过计作用户页面验收。首条正常路径使用现有音频文件，现场麦克风录音不在本切范围；usage/计费开发保持取消。
