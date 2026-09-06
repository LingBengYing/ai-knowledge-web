# Plan

1. 读Java0003契约，先新增API/File、任务epoch/attempt、proxy隔离限额红测试。
2. 在api.mjs与workbench-state.mjs小Interface后封装上传校验/任务状态；app.js新增上传表单与任务面板、清晰空态/错误态/轮询终止。
3. 扩展精确代理路由及独立限额，无框架、依赖或问答假按钮。
4. 显式同步Java内置页面与独立前端；更新AI文档/provenance，运行全部Node测试与语法，交给负责人独立审查、浏览器和Git发布。

技能取舍：fullstack-dev指导同源身份、文件限额和错误；frontend-dev指导表单状态/焦点/aria-live与低动效。现有原生架构与用户功能范围优先，不改为React、不引入营销布局/媒体生成、SSO或跨域身份。

实现者冻结：步骤1–4源码与文档完成；前端56/56、Java Node40/40、语法与diff检查通过。补充2-slot上传exchange限额及列表/任务双向快照合并，各有先红后绿测试。当前未跑Maven、真实Java或浏览器；独立审查/发布不由实现者自批，见REVIEW和VERIFICATION。

发布负责人收尾：独立审查发现旧详情按钮可回退任务，补当前授权行解析Interface及2项回归后，前端58/58、Java Node42/42通过；六静态文件和新增测试显式同步。按用户本次请求只发布前端源码开发版，不等待或冒充Java0003端到端上线；当前真实浏览器只读验证与旧Java管理能力兼容，上传能力仍禁用。实际边界见VERIFICATION，后端发布与生产门禁不变。
