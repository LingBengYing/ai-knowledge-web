# 四类主线与认证外部入口本地整合（2026-10-02）

本任务依协调方授权成为live唯一整合写者。后端基线26f9c43c6d5173a372fad73e96c088c4eb00caae，前端f200f0bb4039513ff9b2dd1307b5d2934b1a36d6；当前是未提交工作树稳定点，不是新Git SHA或已部署版本。Git index/commit/push未操作；既有自动审批拒绝未绕过。

## 合入及接口影响

- 先保存全部24个图片/音视频变更文件的独立快照；既有18文件图片快照原样保留。
- 两个补丁先做只读`git apply --check`，均返回成功。前端patch存在login.html无尾换行、下一diff头连接到HTML的问题；未直接应用它。从隔离源码逐一复制12个原本不存在的新文件，login.html只补尾换行；复制来源及原字节哈希记录在本地交接manifest。开发代理和业务页面未被覆盖。
- 后端11个补丁文件无冲突合入。代码仅入口策略、内部握手、Session GET/Secure Cookie、AuthenticationFilter外部Origin分支及配置；无schema、检索/ACL/证明、production或readiness逻辑修改。旧会话构造兼容现有测试。
- 独立external-server新增当前图片/音视频精确路由、media-sources静态资源、匹配MIME与预算。JSON4MiB；图片上传/图片与帧响应10MiB；文档/音视频上传及原媒体响应20MiB；请求128KiB；普通10秒、上传30秒、四种答案POST180秒。外部身份/Origin/会话保护、最多8在途与2上传/20次每分钟登录限制保留。不给外部入口添加health、任意/v1或Range透传。
- 全媒体按当前会话读完整原文件→SHA→Blob；播放器本地seek，无网络时间转字节Range。图片OCR和视频OCR坐标分别按原合同处理。

## 本次实证

- Node语法与173项默认回归全通过，无失败/跳过；其中外部入口8项、渲染2项。必要适配均保留既有测试目标，没有删跳或放宽断言求绿。
- Java ExternalEntryHttpTest、AuthenticationFilterTest、SessionControllerTest共28项通过；`package -DskipTests`及Spotless585文件通过。依用户要求不重跑全套Java质量/覆盖率评测。
- 当前生成JAR + Node真实JWT会话集成1项通过：匿名登录页、交换Secure Cookie、受保护页面/脚本/config/ACL列表、跨源拒绝、退出。
- 当前编译Java生产classes + 真实原生工具 + 当前外部入口 + 实际前端createApi/AnswerSession：七条完整链全部parsed→indexed→answered→source ready，逐引用当前metadata/内容回读，未认证来源401，readiness始终503。测试JWT为内存随机合成值，所有模型/向量端点为回环替身，空隔离数据目录。本次Java/Node子进程全部关闭。

| 合成素材 / 模式 | 实际回答编号 | 来源类型 |
| --- | --- | --- |
| text / text | afc1b750-ffe3-4c08-b134-9c81a6d963b5 | text |
| ocr / text | 60353d5d-b5af-402e-a30b-196e9cce7636 | image_ocr |
| visual / visual | dbdbff71-0693-4cbc-be10-53ca841a6e2e | image_region |
| audio / audio | b3a7d270-b9b6-47bb-af94-d5a509f41c18 | audio_span, audio_span, audio_span |
| video / video-visual | 54f803ae-855b-46ee-85e1-10aa594ed398 | video_frame |
| video / video-transcript | d73dbd3d-209a-4ff4-aeb1-2c77bdfc62f3 | video_transcript |
| video / video-joint | d43b3232-413a-481c-ba22-0cd6c0fa75ed | video_frame, video_transcript |

PDF来源第1页；图片验证原图SHA，OCR6词框；音频时间分段；视频visual/joint原帧另验SHA。可追溯原文件指纹随本地result.json和稳定交接清单保留。0008功能验证见[verification](../0008-audio-video-library/verification.md)。

## 仍缺的真实配置/验收

1. 文本模型：已批准的embedding/rerank/generation端点、确切模型名、鉴权；embedding维度和不可变revision。
2. Milvus：真实可达根endpoint、凭据、独立database与java_集合，且与embedding维度/revision匹配。本机未启动/验收真实Milvus。
3. 图片：OCR可执行文件/语言包/revision；视觉模型实际endpoint/model/key。当前后端图片视觉上传优先于OCR，需依实际证据目的配置，不声称同时得到两种索引。
4. 音频：服务器FFmpeg/ffprobe路径和ASR实际endpoint/model/key；视频另需自己的ASR与VLM配置，视频OCR可选显式工具/语言/revision。没有复用私人密钥或用历史付费余量。
5. 外部入口：真实公开HTTPS Origin、受信签发方JWT配置、批准TLS证书/私钥路径、服务器执行环境、nginx配置验证与用户浏览器。Node只收public/backend origin/port，不收JWT签名或模型秘密。

未验证真实模型质量、真实Milvus、当前浏览器codec播放、TLS/nginx/公网四类。0019历史真实失败台账不变；production环境仍拒绝，ready503不改成成功。部署任务可按交接文件哈希只读导出整合产物，不能把本机替身结果作为真实能力证明。

## 续接证据补充

随后使用当前前端Module和生产Java/native完整装配，补验video-ocr和video-subtitle原始MP4来源链通过；详见0008 verification。该补充通过本机开发入口完成，不扩大之前JWT七链的证明范围。实际浏览器页面调用被用户访问权限政策拒绝，页面布局/播放仍未验证。原稳定交接快照不覆盖，本次提供独立v2来源清单，产品代码与JAR字节未变化。
