# AI Knowledge Web：智能体工作约定

先读 [README](README.md)、[AI_CONTEXT](docs/AI_CONTEXT.md)、[ARCHITECTURE](docs/ARCHITECTURE.md) 和 [API_CONNECTION](docs/API_CONNECTION.md)，再按顺序读当前 [0002-text-ingestion](docs/changes/0002-text-ingestion/) 的 intent、spec、plan、REVIEW。工件和实际路由是 source of truth；0001为历史发布基线。

- 当前为管理前端、后端显式启用的PDF/TXT/MD上传与解析任务、本地开发代理，不是完整 Java RAG 或生产部署。只有capabilities同时含text_upload/ingestions才启用；parsed不是indexed/ready。不可将禁用按钮、类型筛选或合成资料写成多模态/问答已完成。
- `public/` 导出来源见 [PROVENANCE](docs/PROVENANCE.md)。修改功能必须新建变更工件并保留完整 UI 回归；不要静默覆盖另一仓库的对应文件。
- 小 Interface 隐藏复杂 Implementation。Java 负责身份、ACL、事务与证据；前端不能放宽它们。开发代理不得引入任意目标地址、通配 CORS、任意转发头、无校验 Origin 重写或生产身份声明。
- 不持久保存 JWT，不在浏览器内放 provider key；文档、错误和日志不得含凭据、正文、私钥、数据库、真实主机或私人路径。`.env` 不提交；仅使用明确合成 fixtures。
- 文件 ownership 先明确，共享工作树不回退其他修改；先失败用例或可复现验证，再实现，再完整回归，禁止删/跳过/放宽失败测试求绿。
- 必跑 `npm run check`、`npm test`；发布时先暂存明确文件，再跑 `npm run check:secrets`、`git diff --check`。扫描器覆盖 index/对应工作树与可达历史，不扫描尚未跟踪文件；shallow 历史失败关闭。
- 浏览器导航或 reload 后读取新状态，旧 refs 不复用；首个失败停止操作序列并重新读取。单测、HTTP stub 和历史截图不替代本次浏览器或生产验收。
- 交付记录 spec 对应行为、红绿证据、测试命令、相关 acceptance、偏离及未验证项。纯导出没有 RAG 行为，RAG acceptance 记不适用而非通过。
- 后续 RAG invariant 保留：文档是数据、ACL 先于模型上下文、完整 selected set 不扩成全库、服务端来源校验、无证拒答、整理不改变证据身份；这些不是本次新增功能。
- 上传仅原始File、1..20MiB、固定精确路由；任务只显示安全字段，不显示正文。单任务轮询必须有epoch/attempt保护并在终态停止；写操作不得自动重试。扩大上传限额不得扩大JSON、Origin、Host、Authorization或Cookie信任边界。
