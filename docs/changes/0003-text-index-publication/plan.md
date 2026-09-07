# Plan

1. 以Java0004已冻结intent/spec/plan/REVIEW和现有解析实现为契约，先扩展状态与精确代理红测。
2. Browser State Module增加独立indexTask Interface，保持解析链；Browser UI使用单任务面板按kind展示，创建与重试经过明确确认。
3. 只增加四条固定无body/query路由，保留代理全部限额、认证和写请求不重试规则。
4. 从Java内置页面显式同步六静态文件及新增UI测试，更新来源与能力文档。运行两仓全部Node测试、语法及diff检查，交给负责人做独立审查/真实Java浏览器验收。

技能：fullstack-dev用于同源fetch、现有会话身份、轮询和安全错误；不引入框架、refresh token、CORS或新的认证系统。

文件ownership：本子任务拥有Java静态页面/索引UI测试及本仓库对应文件、代理和相关文档；Java实现、配置、Maven和真实服务验收由其他工作上下文负责。共享工作树不得回退别人修改。

执行边界：按负责人要求，当前增量保持IMPLEMENTATION工作区，不提交或推送。开发先依据Java0004契约启动红测，本独立前端工件随后补建；未将工件补建当作提前独立评审。真实浏览器、Maven和provider/Milvus未在此子任务执行，结果见VERIFICATION。
