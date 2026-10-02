# AI Knowledge Web · 知识库工作台

当前工作区：[0006有据问答](docs/changes/0006-grounded-answers/intent.md)，2026-10-02。已接通PDF/TXT/MD导入、解析、显式索引、文本证据提问及服务器引用回读。Java必须显式开启各能力；未启用时页面说明原因，不生成假答案。当前0006未提交、推送或部署，既有0003–0005源码已由专门Git任务推送；历史工件中的Git状态保留为当时记录。

本机浏览器已走通合成PDF上传→索引发布→选中资料提问→650元证据答案→同版本来源回读。运行的是当前Java源码编译的隔离Spring/SQLite服务，模型与向量服务为loopback协议夹具；这证明功能闭环，不认证真实provider语义质量、真实Milvus整链或生产。完整证据与未验证项见[0006验证](docs/changes/0006-grounded-answers/verification.md)。

配套 [AI Knowledge Java](https://github.com/LingBengYing/ai-knowledge) 的独立原生 HTML / CSS / JavaScript 前端。

顶部导航为资料库、处理任务、知识问答、设置，分别具有hash地址；保留列表筛选、分页、目录、标签、批量整理和详情草稿。任务页只显示当前授权资料页的任务，不代表全部历史。新问答代码仅在本仓库，不自动同步Java内置静态页面。

知识问答支持全库或完整所选资料范围；引用展示编号、原文件名、页码、摘录和版本，点击后按当前身份向Java重新校验。无证据时展示服务器拒答原因。答案与摘录为纯文本；取消仅停止本地等待，不宣称取消服务器处理。旧管理接口的can_answer=false不隐藏入口：入口只是选择范围，能否使用资料证据由Java验证。

保留[0005本地文件预览](docs/changes/0005-media-preview/verification.md)：图片缩放/旋转、音视频播放、PDF与纯文本阅读，文件留在浏览器，不上传或关联库内记录。库内多模态上传、typed媒体来源、摘要及查询附件网页仍待接线；不能把本地预览或文本来源回读说成这些能力已完成。

For AI agents: this repository contains the standalone native JavaScript knowledge workbench, including capability-gated grounded text answers and current-authorized source rereads. Java owns retrieval, models, ACL and evidence verification. Start with [0006 change artifacts](docs/changes/0006-grounded-answers/), [AI_CONTEXT](docs/AI_CONTEXT.md), [AGENTS](AGENTS.md), and [API_CONNECTION](docs/API_CONNECTION.md). Multimodal web integration, real-provider quality and production remain incomplete.

## 本地运行

需要 Node.js 22+。没有第三方 npm 依赖、无需 `npm install`、无需前端构建或模型 API key。

先按 [Java 仓库快速开始](https://github.com/LingBengYing/ai-knowledge#快速开始) 启动独立 Java 服务，默认 `http://127.0.0.1:18084`。开发演示身份须在 Java 端显式启用 `RAG_AUTH_MODE=development_headers`；空库显示空状态，合成资料由 Java 的显式 seed 工具创建，前端不会生成或自动导入业务资料。

需要真实文本上传时，使用支持`0003-text-ingestion`的Java版本，在独立本机数据目录启动并显式设置`RAG_INGESTION_ENABLED=true`。该能力默认关闭且只允许loopback；前端必须看到Java的`text_upload`与`ingestions`两个capability才开启按钮。旧后端仍可用于资料管理，但不会自动获得上传能力；不要为此直接复用或替换其他服务的数据目录。

索引入口要求Java显式启用`RAG_INDEXING_ENABLED=true`并返回`text_index/indexings`，且当前资料行允许索引。模型与独立Java Milvus集合由后端配置，页面不接受provider key。点击“建立索引”或“重试索引”先说明外部处理与调用费用，确认后才发送请求。parsed终态自动回读授权列表取得索引权限，indexed终态回读服务器发布版本；前端不会自行设置active证据版本。

文本问答还要求Java显式设置`RAG_ANSWERS_ENABLED=true`并同时返回`answers/sources`。在“知识问答”问全库，或从资料行/批量工具进入完整所选范围；所选范围不会过滤未发布资料，也不在空范围或错误时回退全库。Java负责范围与证据可用性，配置及质量验收见后端项目文档。

然后在本仓库根目录执行：

```bash
npm run dev
```

打开 [前端工作台](http://127.0.0.1:18085/)。必须使用 `127.0.0.1`，不要改成 `localhost`。页面通过同源开发代理连接 Java；Java 未启动时页面会显示安全连接错误，不返回假数据。

```bash
RAG_WEB_BACKEND_ORIGIN=http://127.0.0.1:18084 RAG_WEB_PORT=18085 npm run dev
```

配置仅接受字面量 `127.0.0.1` 的 HTTP origin 与合法端口；前端端口禁止80，避免浏览器省略默认端口导致同源身份歧义。不能填公网域名、用户信息、路径、查询或 fragment。[.env.example](.env.example) 没有密钥，程序也不自动加载 `.env`。`NODE_ENV=production` 拒绝启动。

JWT 模式使用 Java 的 `/v1/session` 交换 HttpOnly Cookie，输入提交后清空，不写入 localStorage / sessionStorage。本仓库没有令牌签发或刷新服务；模型和 JWT 签名密钥只能留在后端。浏览器 Cookie 按主机而非端口隔离，详见 [SECURITY](SECURITY.md)。

## 范围与运行方式

| 内容 | 当前状态 |
| --- | --- |
| `public/` 工作台 | 独立原生静态页面；0006不自动同步Java资产，历史导出来源见PROVENANCE |
| ACL、目录、标签、持久化、审计 | 由 Java 服务实现，前端不替代权限检查 |
| Node 开发服务 | 仅静态文件 + loopback 同源适配，无业务数据库 |
| PDF / TXT / MD上传与任务 | 后端capability启用后可用；原始文件1字节至20MiB，最多3次attempt |
| 文本索引任务与发布状态 | 显式能力、当前权限与确认框门禁；解析/索引终态回读服务器列表 |
| 文本证据问答与来源 | answers/sources启用后可用；本机浏览器闭环已检查，真实provider/Milvus质量待验 |
| 多模态网页、文件摘要、查询附件 | 未接通；类型筛选和本地预览不代表这些流水线 |
| 生产发布 | 未验收；不能把开发代理暴露公网或套反向代理使用 |

静态资源也可作为 Java 同源页面使用，无需 Node 运行时；后续生产需要独立设计 TLS、身份、Cookie、代理信任和发布门禁。当前不是可以直接部署 GitHub Pages 后跨域调用的应用。

上传后查看解析任务面板；queued/processing约每1.5秒刷新，终态停止。索引使用独立任务，可从列表或详情重新查看，按服务器允许取消/重试。切换身份、筛选或分页会清空当前任务显示，但不会取消后台任务。网络错误会暂停轮询，不自动重发写请求；上传或索引写请求响应丢失时先刷新列表/任务核对。开发代理最多两个上传请求同时在途，超出返回429。

代理的普通请求期限为10秒，文本上传为30秒，只有精确POST `/v1/answers`为180秒；来源GET仍为10秒。问答不是SSE，也不自动重试。身份或范围切换、新问题会清除旧答案和来源，404/401来源不保留旧摘录为当前验证成功。

## 验证与文档

```bash
npm run check
npm test
npm run check:secrets
```

`check:secrets` 要求 Git 仓库，检查已暂存文件、对应工作树和所有可达提交历史。新增未跟踪文件须先暂存再扫描；不能把空 index 的扫描当作完整发布验证。

- [AI_CONTEXT](docs/AI_CONTEXT.md)：AI 检索入口与能力边界
- [ARCHITECTURE](docs/ARCHITECTURE.md)：Module、信任边界与源码地图
- [API_CONNECTION](docs/API_CONNECTION.md)：实际转发路由、认证与连接诊断
- [VERIFICATION](docs/VERIFICATION.md)：测试证据与未验证项
- [PROVENANCE](docs/PROVENANCE.md)：导出版本、文件摘要与测试来源
- [SECURITY](SECURITY.md)、[CONTRIBUTING](CONTRIBUTING.md)、[llms.txt](llms.txt)

本仓库尚未指定开源许可证；公开可读不等于已授予 MIT / Apache 等许可。AI 导航不保证搜索引擎或模型自动收录。
