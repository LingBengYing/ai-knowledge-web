# Verification

## 当前0002文本上传 · 2026-09-06

- 发布负责人在审查修复后重跑全量Node测试58项（31 UI、16真实HTTP代理stub、11 secret checker），0失败/取消/跳过；`npm run check`语法检查通过。原43项基线全部保留，未修改secret checker豁免或限额。
- 红绿：新UI测试先因缺少上传/任务导出失败；新增三项代理测试先404失败，实现精确路由后通过。两上传在途容量测试先收到504而非429，加入2-slot约束后通过。旧列表快照覆盖新任务测试先queued而非parsed，修复仅当前授权行的合并后通过。
- 新回归覆盖原始File及编码文件名、空/超限/非法文件拒绝、task bodyless POST、task字段白名单、身份epoch/任务身份/attempt及终态防回退、精确代理限额/时限/并发回收；既有Host/Origin/Authorization/Cookie负例原样保留。
- 六静态文件显式同步Java；新增Java UI测试只有import路径转换，摘要见[PROVENANCE](PROVENANCE.md)。secret checker脚本与11项测试未修改。
- Java仓库仅运行`node --test ui-tests/*.test.mjs scripts/check-secrets.test.mjs`，审查修复同步后42/42通过；两仓库`git diff --check`通过。六静态文件逐字节相等、新增测试路径转换相等、当前Markdown本地链接可解析。Node测试不认证Java后端源码。
- 独立审查发现单向保护会用本地旧终态覆盖列表较新attempt；新增反向用例先1≠2失败。改为按attempt/状态进展合并，采用较新动作权限，并同步重绘面板/恢复待处理轮询；两方向回归保留。
- 发布前独立审查另外发现详情按钮闭包会重新打开旧attempt/状态。新增两项回归先因缺少当前行解析Interface失败，修复后完整58项通过：`taskForDocument`只读取当前授权列表行并校验资料身份；覆盖跨attempt、同attempt终态、页面/身份失效及错配资料，详情编辑表单不会因轮询被重建。
- 本次只读浏览器兼容验收：当前源码开发代理在独立本机18087连接原Java18084；live200、ready503、config为`management_slice`。重新加载后显示4份合成资料、owner身份、目录与标签，上传和问答保持禁用。没有修改已有资料或重启旧服务；新上传真实Java/浏览器端到端、JWT交换、移动端和生产未在本次验收。配套Java0003仍是独立开发中的后端变更。
- 明确暂存源码、测试与文档后，`npm run check:secrets`扫描index、对应工作树和完整可达历史，结果`[]`。这是防御性检测，不是任意未知secret的数学证明。无Maven或真实provider调用；发布后的远端提交和GitHub Actions结果另行核对。
- RAG答案/检索golden acceptance不适用：本变更到parsed止步，未接通索引、问答、摘要或多模态，不能记为通过。新上传链路的Java acceptance见后端0003记录。

## 0001历史发布验证 · 2026-09-06（不认证当前变更）

- 最终 `npm test`：43项全部通过，0失败/取消/跳过。包含原20项UI行为、原11项secret checker、12项新增开发代理测试；主线程和独立审查分别重跑通过。
- `npm run check`：`public`、`scripts`、`tests`、`ui-tests`全部JavaScript语法检查通过。无第三方依赖、无构建产物；`public/`即交付静态资源。
- 代理红绿：先运行HTTP测试得到`ERR_MODULE_NOT_FOUND`（实现缺失）；实现后真实HTTP首轮8/9，静态POST负例因缺Origin先被403拒绝，补齐同源Origin后保持原405断言通过。新增deadline覆盖上传及流响应、Cookie/身份隔离测试后完整42/42。
- 沙箱禁止loopback监听产生的EPERM已单独排除；在获准本机HTTP环境重跑，不把工具环境故障当作应用失败或跳过测试。
- 只读复核指出“丢弃显式Authorization后仍转发有效Cookie”会改变后端的凭据优先级；已改为任何Authorization先400拒绝，并在真实HTTP负例中覆盖单头/重复头携Cookie且后端零调用。修正后完整42项与语法检查再次通过。
- 静态六文件与secret checker两文件摘要见 [PROVENANCE](PROVENANCE.md)；最终独立复核与提交后的完整历史扫描由发布步骤记录。
- 审查修复后保留全部原断言：Authorization 与 Cookie 并存一律400且零转发；单文档GET不冒充后端接口，405零转发、PATCH正例通过。新增前端80端口拒绝回归先出现 `Missing expected exception`，修复两处配置入口后完整43/43通过。
- 独立只读审查 PASS，限本地开发源码。代理与测试冻结SHA-256分别为 `2dd36e28cb0934f739c9f606607db0fabf5aa740b8e05e5250f72bd1b396c2df`、`da9a4383b672c051a5dbf17653d53301d53f96a4283d5e5d948d330af11f9ae3`；13份Markdown的相对链接均可解析。
- 最终源码实际启动：前端18085连接已运行Java18084，live200、ready503原样保留、config显示 `management_slice` 和原能力集合。新浏览器页实际加载成功，显示owner身份、4份合成资料、目录/标签与禁用上传/问答按钮。本次仅只读验收，没有修改现有资料，也未重做JWT交换、全部交互或移动端回归。

## 0001历史验证边界

HTTPstub验证精确Host/Origin/fetch-site检查、身份/会话头allowlist、JSON方法/路由、静态allowlist与symlink、限长、总deadline、后端故障和3xx不跟随。不调用真实模型、不触碰数据库；UI模块测试不等于本次真实浏览器验收。

本次没有RAG行为变化；检索/回答golden acceptance不适用，不能记录“通过”。完整Java迁移、真实Milvus/provider、多模态与生产gate保持未完成。

## 0001历史发布状态

独立实现、本地测试、只读审查和真实Java浏览器加载已完成。提交后的远端SHA/树及 [GitHub Actions](https://github.com/LingBengYing/ai-knowledge-web/actions) 按实际发布结果核对；CI配置本身不是通过证明。本文件不认证未来提交，静态来源见PROVENANCE，完整源码由Git提交绑定。
