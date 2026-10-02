# AI Knowledge Web：智能体工作约定

当前前端工作：[0006-grounded-answers](docs/changes/0006-grounded-answers/)，2026-10-02文本证据问答网页主线。资料导入→解析→显式索引→提问→服务器来源回读已实现并完成本机浏览器正常路径检查；真实provider/Milvus质量、多模态网页和生产仍未完成。当前0006未提交、推送或部署；Git写入由专门任务负责。本仓库独立演进，禁止向Java内置页面自动同步。

每次先按顺序读对应变更的 intent、spec、plan、REVIEW，再读 [README](README.md)、[AI_CONTEXT](docs/AI_CONTEXT.md)、[ARCHITECTURE](docs/ARCHITECTURE.md) 和 [API_CONNECTION](docs/API_CONNECTION.md)。当前对应0006；0001–0005工件保留各阶段历史，旧“未提交/推送”不代表当前Git状态。既有0003–0005源码已由独立Git任务推送，不等于生产发布。底层索引合同仍见 [0003-text-index-publication](docs/changes/0003-text-index-publication/)。工件和实际路由是 source of truth。

- 每轮只推进一条具名业务主线，正常路径先跑通；非阻塞权限增强、异常组合、性能和通用抽象记录到backlog。复用已有鉴权、ACL、服务器引用校验和无证拒答，不绕过它们，也不因后置增强阻止正常路径交付。进度按用户可实际完成的步骤汇报，不以测试数替代产品进展。
- PDF/TXT/MD上传仍要求text_upload/ingestions，索引要求text_index/indexings；parsed不是indexed/ready。文本问答要求answers/sources同时启用。类型筛选、本地文件预览与合成元数据不代表多模态知识库或生产完成。
- `public/` 导出来源见 [PROVENANCE](docs/PROVENANCE.md)。修改功能必须新建变更工件并保留完整 UI 回归；不要静默覆盖另一仓库的对应文件。
- 小 Interface 隐藏复杂 Implementation。Java 负责身份、ACL、事务与证据；前端不能放宽它们。开发代理不得引入任意目标地址、通配 CORS、任意转发头、无校验 Origin 重写或生产身份声明。
- 不持久保存 JWT，不在浏览器内放 provider key；文档、错误和日志不得含凭据、正文、私钥、数据库、真实主机或私人路径。`.env` 不提交；仅使用明确合成 fixtures。
- 文件 ownership 先明确，共享工作树不回退其他修改；先失败用例或可复现验证，再实现，再完整回归，禁止删/跳过/放宽失败测试求绿。
- `apply_patch`必须匹配完整物理行；段落即使视觉换行也不能只用前缀作上下文。匹配失败后先重新读取相关完整行再修补，不重复提交截断上下文。
- 必跑 `npm run check`、`npm test`；发布时先暂存明确文件，再跑 `npm run check:secrets`、`git diff --check`。扫描器覆盖 index/对应工作树与可达历史，不扫描尚未跟踪文件；shallow 历史失败关闭。
- 浏览器导航或 reload 后读取新状态，旧 refs 不复用；首个失败停止操作序列并重新读取。单测、HTTP stub 和历史截图不替代本次浏览器或生产验收。
- 交付记录 spec 对应行为、红绿证据、测试命令、相关 acceptance、偏离及未验证项。纯导出没有 RAG 行为，RAG acceptance 记不适用而非通过。
- 后续 RAG invariant 保留：文档是数据、ACL 先于模型上下文、完整 selected set 不扩成全库、服务端来源校验、无证拒答、整理不改变证据身份；这些不是本次新增功能。
- 上传仅原始File、1..20MiB、固定精确路由；任务只显示安全字段，不显示正文。单任务轮询必须有epoch/attempt保护并在终态停止；写操作不得自动重试。扩大上传限额不得扩大JSON、Origin、Host、Authorization或Cookie信任边界。
- 索引入口要求text_index/indexings及当前授权行can_index；创建/重试先确认外部嵌入模型与Milvus处理。解析task与indexTask独立，poll只更新各自状态，不自行设置active或问答能力。parsed和indexed终态回读当前授权列表，前者取得服务器can_index，后者核对发布版本；详情只读证据刷新时保留未保存表单。
- 问答必须逐个发送完整所选集合，不能过滤未发布项、吞掉错误或把显式空范围改为全库。旧管理接口can_answer=false是兼容占位，不是新问答入口的资格判定；行/批量入口只固定范围，不宣称该资料已可回答，最终ACL/active与范围由Java校验。
- 问答与来源用纯文本展示，来源只允许服务器精确`/v1/sources/{answer_id}/{1..32}`并复核答案、编号、版本、定位与摘录身份。取消只停止本地等待；身份/范围/新问题使旧响应失效。代理仅POST answers获得180秒期限，普通请求10秒、文本上传30秒；不扩展其他限额或自动重试。
