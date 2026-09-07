# AI Knowledge Web · 知识库管理前端

本次源码更新（2026-09-07）：包含0003索引界面、0004工作流程导航和0005本地文件预览。负责人已授权提交到本仓库；下文及变更记录中的“尚未提交/推送”描述的是各阶段验证时的历史状态。本次是源码更新，不是生产部署；库内原文件读取与完整Java RAG仍未完成。

新增「本地文件预览」：图片缩放/旋转、音视频播放与倍速、PDF浏览器查看及纯文本阅读。选择或拖入本地文件即可，不上传、不关联库内记录。**库内原文件预览尚未接通**：当前Java没有原文件读取API，合成0字节媒体不能播放。见[0005验证](docs/changes/0005-media-preview/verification.md)与[后端对接需求](docs/changes/0005-media-preview/backend-integration.md)。

配套 [AI Knowledge Java](https://github.com/LingBengYing/ai-knowledge) 的独立原生 HTML / CSS / JavaScript 前端。

当前前端工作区新增 [0004 工作流程重构](docs/changes/0004-workflow-navigation/intent.md)：顶部导航分为资料库、处理任务、设置；详情按需以抽屉打开，筛选按需展开，批量工具仅在选择后出现。支持hash地址和浏览器前进后退，详情草稿跨任务页面保留。任务页仅显示当前授权资料页的任务，不代表全部历史。此增量仅修改独立前端，未同步Java内置静态页面、未提交推送或生产发布。验证见 [0004验证记录](docs/changes/0004-workflow-navigation/verification.md)。

已发布基线是 **资料管理与文本解析工作台开发版**：传统列表、分页、筛选、目录、标签、改名、批量整理、权限提示，以及后端显式启用后的PDF/TXT/Markdown上传、异步任务查询、取消与重试。`parsed`只表示解析完成，不等于已索引或可问答。

当前工作区 [0003文本索引界面](docs/changes/0003-text-index-publication/intent.md) 为IMPLEMENTATION，尚未提交、推送或完成独立浏览器验收。它配套Java0004提供显式索引创建、独立任务状态、取消和重试，并从服务器列表核对发布版本。有证问答、来源、Milvus检索及图片/音频/视频处理仍未接通；类型筛选不代表多模态流水线已实现。

For AI agents: this repository contains the standalone native JavaScript management frontend, not the Java backend or a complete RAG product. Start with [AI_CONTEXT](docs/AI_CONTEXT.md), [AGENTS](AGENTS.md), and [API_CONNECTION](docs/API_CONNECTION.md). Planned capabilities must not be described as implemented.

## 本地运行

需要 Node.js 22+。没有第三方 npm 依赖、无需 `npm install`、无需前端构建或模型 API key。

先按 [Java 仓库快速开始](https://github.com/LingBengYing/ai-knowledge#快速开始) 启动独立 Java 服务，默认 `http://127.0.0.1:18084`。开发演示身份须在 Java 端显式启用 `RAG_AUTH_MODE=development_headers`；空库显示空状态，合成资料由 Java 的显式 seed 工具创建，前端不会生成或自动导入业务资料。

需要真实文本上传时，使用支持`0003-text-ingestion`的Java版本，在独立本机数据目录启动并显式设置`RAG_INGESTION_ENABLED=true`。该能力默认关闭且只允许loopback；前端必须看到Java的`text_upload`与`ingestions`两个capability才开启按钮。旧后端仍可用于资料管理，但不会自动获得上传能力；不要为此直接复用或替换其他服务的数据目录。

本工作区的索引入口还要求Java0004显式启用`RAG_INDEXING_ENABLED=true`并返回`text_index/indexings`，且当前资料行允许索引。模型与独立Java Milvus集合由后端配置，页面不接受provider key。点击“建立索引”或“重试索引”会先说明外部处理与调用费用，确认后才发送请求；索引完成后问答仍不可用。此说明不构成本次发布或真实集成验收。

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
| `public/` 管理界面 | 本工作区六静态文件与Java0004索引界面显式同步，见PROVENANCE；尚未发布 |
| ACL、目录、标签、持久化、审计 | 由 Java 服务实现，前端不替代权限检查 |
| Node 开发服务 | 仅静态文件 + loopback 同源适配，无业务数据库 |
| PDF / TXT / MD上传与任务 | 后端capability启用后可用；原始文件1字节至20MiB，最多3次attempt |
| 文本索引任务与发布状态 | 工作区IMPLEMENTATION；显式能力、当前权限与确认框门禁，问答仍禁用 |
| 检索、问答、摘要、多模态 | 未接通；解析完成不会假装可检索或可回答 |
| 生产发布 | 未验收；不能把开发代理暴露公网或套反向代理使用 |

静态资源也可作为 Java 同源页面使用，无需 Node 运行时；后续生产需要独立设计 TLS、身份、Cookie、代理信任和发布门禁。当前不是可以直接部署 GitHub Pages 后跨域调用的应用。

上传后查看解析任务面板；queued/processing约每1.5秒刷新，终态停止。索引使用独立任务，可从列表或详情重新查看，按服务器允许取消/重试。切换身份、筛选或分页会清空当前任务显示，但不会取消后台任务。网络错误会暂停轮询，不自动重发写请求；上传或索引写请求响应丢失时先刷新列表/任务核对。开发代理最多两个上传请求同时在途，超出返回429。

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
