# Plan

1. 冻结当前缺口并先加文件类型/生命周期红测。
2. 新建Preview Module，以File/Blob和release为小Interface，独立模块处理本地媒体，不混入资料/任务状态。
3. 增加独立预览dialog、详情缺口说明和文件选择/拖放；扩展前端静态资源allowlist与最小blob CSP。
4. 完整Node/语法检查、浏览器合成文件验收及独立审查；记录现有库内原文件读取未完成的后端依赖。

Ownership：仅ai-knowledge-web/public、前端dev-server静态/CSP配置、测试及文档。绝不修改Java、Python、数据库、后端进程或其内置页面。
