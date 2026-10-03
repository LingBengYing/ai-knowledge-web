# 当前本机验证（2026-10-03）

0019/后端0030已接原视频参考查询。VISUAL、AUDIO、JOINT三模式在实际声明`video_av_query_attachments`且原视频完整能力可用时，接受1..3个VIDEO原文件、合计20MiB，经精确`POST /v1/video-av-query-answers`辅助检索库内证据。旧能力不能开启新入口；无附件仍走原问答路径。本切只覆盖原视频参考，不代表图片、音频参考的后续主线已经完成。

## 前端实际门禁与输入绑定

- 最终协调执行`npm test`：370 PASS，0失败、取消、跳过或todo；`npm run check`通过。新增26项由模块15项、两个代理8项、当前页面DOM 3项组成。
- 最终57个构建输入的执行前后快照完全相同，并逐项匹配当前源码。快照含测试和静态资源；收录部署测试文件不表示运行了部署验收。
- 独立读取0029冻结包实际日志与manifest后，按完整用例名称和出现次数比较：旧344项全部保留，9组各出现两次的同名用例多重性不变，新增26项。旧29个测试/资源文件全部保留，其中27个字节未变。
- 两个旧测试文件的必要适配单列记录：`task-detail.test.mjs`只新增能力harness和3项测试，原主体/断言保留；`video-av-transport.test.mjs`仅将已开放的新路由负例改为`/v1/video-av-query-answers/more`，保留原404、零转发断言及用例身份。未删除、跳过或放宽旧用例。

实际证据均位于工作区`.tools/video-av-query-verification/`：`frontend-coordinator-full.log`、`frontend-coordinator-syntax.log`、`frontend-coordinator-result.json`、`frontend-inputs-final-before.json`、`frontend-inputs-final-after.json`及`frontend-retention-audit-c.json`/`.md`。两个57项快照的SHA-256均为`abf5421daaa2f146aedf99d4dc5dd0544fcbd624374ec6d0ecbb422176c2b8d6`；独立保留审计为PASS、0 findings。

## 行为覆盖与真实RED范围

新增行为覆盖三个模式与独立能力门禁、同一次完整File读取的编码和SHA绑定、原附件数量/顺序/模式绑定、精确三字段envelope及十一字段receipt、完整选中范围和显式空范围、取消与身份/问题/模式/范围变化后的迟到隔离。处理失败必须是完整输入组的`not_prepared`与空处理字段，不展示部分成功；缺模态提示明确“整批参考未完成处理”。答案来源仍只打开经过完整SHA和服务器窗口核验的库内原视频，参考附件不能成为证明来源。

两个代理只为精确新POST启用28MiB JSON、180秒和既有附件并发限制；其他路径、普通限额及认证/Host/Origin边界保留。页面DOM用例证明当前页面代码的行为，不等同浏览器验收。

| 保留日志 | 实际产品RED |
| --- | --- |
| `frontend-behavior-red.log` | 3项失败：原实现对三个模式的原视频附件均在转发前拒绝。 |
| `frontend-dom-red.log` | 1项失败：新能力未启用当前页面控件。 |
| `frontend-transport-red.log` | 2项失败：两个代理均对精确新入口返回404。 |

以上为实际行为缺口，未把编译或夹具错误计作产品RED。首轮370/check日志`frontend-full.log`、`frontend-syntax.log`保留；拒答文案修正后的3项DOM、370/check记录为`frontend-wording-related.log`、`frontend-full-final.log`、`frontend-syntax-final.log`，最终协调日志另存，没有覆盖早期记录。

## 后端共同门禁与制品绑定

根代理实际执行并封存的`backend-final-evidence.json`确认：2640个默认Java用例全部通过，0失败/错误/跳过；原2567个默认用例保留；894个Java文件通过Spotless，73个后端Node用例通过。LINE为26652/28597（93.1986%），BRANCH为14200/17641（80.4943%），原双80%门槛保持。910个后端输入及57个前端输入绑定执行结果，执行前后无变化。

原视频新链与声音、音频向量、图片向量、原查询附件、语音问题五条既有Native链各通过一项。实际结果见`backend-native-second-result.json`与`backend-native-regression-result.json`；Native执行使用的全部668个生产class与最终target和JAR逐字节相同。最终`rag-java-0.1.0-SNAPSHOT.jar`为39,356,541字节，SHA-256为`754ef7dfbc485d0cfce6527d3025b0b07a81698f4e15448170d96301eef57da8`。本机真实Spring/SQLite/FFmpeg配合loopback协议替身，不认证真实模型语义质量。

新查询trace保存完整准备身份、embedding revision和双投影profile，不保存原附件、ASR或向量值；`content_sha256`只绑定完整媒体准备结果，不宣称所有向量调用成功。全部实际窗口的调用完整性由行为及Native观察断言验证。来源重启回读、完整授权范围、候选映射和整批失败边界仍由后端负责。

## 交接与未执行边界

交接包预定工作区`.tools/video-av-query-handoff`，此记录不宣称已经冻结；后续以实际manifest、validation和独立审计为准。本切未部署、未运行浏览器、新增真实模型调用为0，未进行Git写入。当前已核对的部署仍为`voice-tags`，页面验收由用户负责；本切没有再次访问部署服务器。开发目标保持active，usage/计费开发已取消。
