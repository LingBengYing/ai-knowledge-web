# Plan

当前状态（2026-10-02）：Mac mini恢复开发并完成图片稳定切片。步骤1–3与必要功能验证已完成；当前真实Java+前端Module OCR/视觉两条链路通过。用户最新要求优先主线、完整评测后置，不另开检查任务；本轮由主任务串行实现，未派worker或独立审查。没有把受控DOM/Node集成当作真实浏览器或云质量验收，详见[verification](verification.md)。

1. 核对Java0010/0012真实合同，冻结本工件与小Interface，补失败用例。
2. Module worker拥有api.mjs/answers.mjs及其直接测试：有界图片上传、binary源读取、显式visual模式、typed来源/原字节SHA/epoch；root拥有app/index/styles/实际DOM测试。
3. Transport worker仅拥有dev-server.mjs及其测试：精确路由、图片上传与content独立限额、visual独立期限。共享工作树不回退他人修改；无Git写入或云请求。
4. focused→完整Node/语法→独立只读Standards/Spec审查；root用隔离当前Java源运行浏览器合成图片闭环。只新增私有测试数据，不重新准备旧评测或修改Java生产源。
5. 更新项目MD与verification，明确本机功能与真实质量/生产边界。

下一主线：音频、视频导入/处理/索引→检索匹配→原素材与时间片段网页访问，属于用户四类主线验收；图片切片交Git任务后沿Java既有typed合同继续。后置项：摘要与查询附件、跨图/多模态自动路由、全面模型评测及非阻塞异常组合/权限增强/性能。真实provider/Milvus与公网四类检索/来源仍需实际验证，不以loopback替代；不破坏既有安全底线。
