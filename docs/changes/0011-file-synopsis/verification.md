# 0011 文件摘要网页本机验证

2026-10-03：已接通资料详情的持久摘要读取、显式确认生成、独立任务进度、概览/主题/术语/媒体时间线，以及八类原始依据回读。失败不影响索引，刷新不丢整理草稿；离页/身份/publication改变停止旧读取/轮询并释放媒体。当前未发布，用户页面验收和真实摘要质量未执行。

## 合同与证据

| 合同 | 当前证据 |
| --- | --- |
| SW-01 门禁与显式生成 | 实际app能力关闭/未索引说明；当前publication及can_edit检查，只读可查看但生成禁用，确认对话框前POST为0、提交后一次 |
| SW-02 持久任务 | Session从404到queued→processing→available→持久摘要；1500ms单轮询、终态停止、网络错误暂停后显式刷新、失败后显式创建；已有摘要仅GET |
| SW-03 当前身份与内容 | document/publication/revision/sourceSHA绑定；one-based entry/reference及精确URL、section/time范围；实际app四类资料显示纯文本分组，未执行模型HTML |
| SW-04 八类来源 | text/image_ocr/image/audio_transcript/video_frame/video_transcript/video_ocr/video_subtitle全部核对并读取原文件；文本SHA/全文原文件SHA/video_frame引用SHA、图片引用SHA与原图SHA一致性；错身份、locator、URL、文本、原文件拒绝 |
| SW-05 原文件与生命周期 | 实际app PDF按服务器页、图片、WAV/MP4控制与片段seek/停止、来源关闭/离页释放；Module覆盖帧/OCR区域/字幕身份；来源失败清除旧内容；旧详情迟到响应不可重开，刷新不重建表单 |
| SW-06 传输 | 两个真实loopback Node代理及createApi精确摘要路由、无query/body、普通期限/JSON限额、20MiB原文件/10MiB帧、完整200、MIME/非空/限长；0010附件与旧上传/问答边界保持 |

## 实际红绿与最终检查

环境Node v24.14.0，沿既有`.tools/env.sh`，无第三方安装，无真实模型调用。

- Module初始RED：`node --test ui-tests/file-synopsis.test.mjs`，可加载stub接口，8项行为失败。
- app RED：`node --test ui-tests/task-detail.test.mjs`，48项中旧44通过/新增4失败，缺摘要消费者。
- proxy/API RED：`node --test --test-name-pattern='file synopsis' tests/dev-server.test.mjs tests/external-server.test.mjs ui-tests/api.test.mjs`，10项中8失败/2既有对照通过。
- Module审查发现独立图片引用SHA未与完整原图SHA相等，先追加具名RED：9项中8通过/1失败，再补一致性检查；未改旧测试预期。
- 定向GREEN：Module/app 57项全通过；两代理/API 70项全通过。
- 最终 `npm run check`通过；`npm test` **237项全通过，0失败/取消/跳过**。40个生产/测试/静态/package输入在检查前后SHA全部相同；只读`git diff --check`通过。
- 全量测试日志SHA-256：`40cbbb3ad2acf224ba8fc318c7b19e07a3003fefd8c3b184d6e190014e35553a`。私有红绿日志与输入摘要记录在工作区`.tools/file-synopsis-verification/`，冻结交接复制证据。

## 范围与未验证项

app函数运行在既有最小DOM Adapter；来源原字节是明确合成协议夹具，代理是实际loopback HTTP；未执行浏览器排版/播放/PDF像素验收。本轮只读核对当前Java Controller/VO/Mapper/Domain合同，未启动Java/native或调用真实模型，不把旧0015/0016报告当本轮网页运行认证。video_ocr专用frame接口没有独立帧SHA，未声称客户端独立校验该帧，后端仍按当前权限和封存来源返回。

后端/JAR/模型配置/部署副本未改。部署须在既有权限内启用`RAG_SYNOPSIS_ENABLED`及独立摘要模型，保留免登录分支和已完成0010查询附件；创建任务才会触发实际模型处理。未暂存/提交，不把现有index秘密扫描当新增未跟踪源码已获发布认证。

完整目标保持进行中：0010/0011发布与用户验收、真实音频识别偏差及数字修复后的真实复验仍未完成。usage/计费开发继续取消。
