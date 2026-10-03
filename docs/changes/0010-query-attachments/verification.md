# 0010 本机验证

2026-10-03：查询附件网页正常操作已接通。用户可选择图片、音频或视频，添加/移除/清空最多3个临时附件，随原问题和完整资料范围提交，看到逐项处理/失败/视觉采样说明，再打开已有库内来源。附件不入库、不替代库内证据。未发布；页面验收由用户负责。

## 已验证行为

| 合同 | 证据 |
| --- | --- |
| QW-01 能力门禁 | 关闭query_attachments时禁用选择并说明；所选模式仍要求answers/sources；Session不会悄悄丢附件降级为普通问答 |
| QW-02 原始附件 | 全批校验后才读取；三类文件与MP4/WebM显式MIME、3个/20MiB总量/10MiB图片、空文件和路径拒绝；三类65539字节逐字节base64核对 |
| QW-03 原问题与完整scope | 八种证据模式映射、原问题空格/换行/Tab保持、未发布所选项不剔除、显式空scope保持；无附件旧入口/JSON不变 |
| QW-04 生命周期 | 真实app函数防重复提交，读取中取消/范围改变不发POST，移除清除旧答案/来源，身份变化或离页释放选择 |
| QW-05 结果与来源 | mode/count/ordinal/kind/status/采样/reason校验；实际app显示三项反馈、采样、失败；引用只来自库内原typed结果，按原精确URL回读 |
| QW-06 HTTP代理 | 两个真实loopback Node代理：140KiB JSON完整透传，精确28MiB通过/+1字节拒绝，2在途及成功/失败容量释放、完整请求/响应期限，普通128KiB/10秒/4MiB、认证/Origin/Host保持 |

## 红绿及完整回归

环境Node v24.14.0，沿项目`.tools/env.sh`；无第三方安装，无真实模型请求。

- Module/Session RED：`node --test ui-tests/query-attachments.test.mjs`，9项中7失败、2通过。可加载Module明确stub及未接线Session造成行为失败。
- app RED：`node --test ui-tests/task-detail.test.mjs`，44项中新增4失败、旧40通过，缺失附件DOM操作入口。
- proxy RED：`node --test --test-name-pattern='query attachment' tests/dev-server.test.mjs tests/external-server.test.mjs`，16项全失败；旧路由未开放。失败后大请求清理曾产生迟发EPIPE，不另作产品结论。
- Module/app GREEN：9+44=53项全通过；proxy GREEN：57项全通过（新增16+原41）。
- 最终 `npm run check` 通过；`npm test` **214项全通过，0失败/取消/跳过**。38个生产、测试、静态和package输入的SHA在完整检查前后相同。
- `git diff --check`只读检查通过。Git写入仍归专门任务，未暂存/提交；没有把未覆盖新增文件的index秘密扫描冒充发布认证。

本地私有日志：前端`.local/query-attachments-{red,app-red,ui-green,check,full}.log`及工作区`.local/query-attachments-proxy-{red,green}.log`。输入与日志SHA保存在工作区`.tools/query-attachments-verification/`；最终全量日志SHA为`461848378b6efca22e5c2a6f167816e4276d54159d0a650aa7a34a8227e2538a`。

## 结论范围

实际app函数运行在既有最小DOM Adapter中；代理为真实loopback HTTP，Java响应由明确合成协议替身提供。本轮没有启动Java/native媒体处理、执行浏览器验收或访问真实provider；Java 0017合同只读核对，不借旧结果认证新页面或生产。后端源码/JAR、免登录部署分支和服务器配置均未改。部署者需显式配置既有query_attachments及依赖后才能让能力门禁开放，保留其免登录调整，不能整份覆盖external-server/index。

完整知识库目标保持进行中：本增量发布/用户页面验收、真实音频识别质量及当前数字修复后的外部复验仍待完成。持久文件摘要网页是另一条已批准但尚未接通的正常主线；usage/计费开发继续取消。
