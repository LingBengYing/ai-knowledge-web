# Verification

## 当前0003文本索引界面 · IMPLEMENTATION · 2026-09-07

- 当前工作区增量尚未提交或推送，不认证本次已发布基线。最后一次详情权限修复后，实现者完成`npm run check`和`npm test`；91项Node测试通过，0失败/取消/跳过（61 UI、19真实HTTP代理stub、11 secret checker），原58项基线保留。本轮没有执行Git操作；此前diff检查不认证本次补丁。
- 红绿：负责人提供的5项索引状态红测在独立indexTask Interface实现后通过；跨链ticket、能力gating、已发布标签的3项新增测试先失败后通过。索引创建前旧列表隐藏已知任务的回归先因invalid task response失败，按同解析版本合并后通过。当前10项索引UI测试还覆盖详情当前行重开、不同revision不合并、未授权页不插入。
- 新3项代理红测先因未注册索引路由返回404而失败，精确路由实现后通过；覆盖无body/query、普通deadline、错误不自动重试，以及Origin/Authorization/Cookie保留。首次受限沙箱的listen EPERM是环境限制；经自动批准后使用临时ephemeral loopback HTTP fixtures跑完整测试，无跳过。
- 两仓库六静态文件显式逐字节同步，新增索引与详情测试仅import路径不同。来源记录见[PROVENANCE](PROVENANCE.md)，本轮app和详情测试摘要已交负责人更新冻结记录；未修改secret checker豁免或生产门禁。
- 独立审查发现两项P2：failed/cancelled轮询只刷新列表，详情状态停留processing；取消/重试成功的loadData重建详情表单，丢失未保存输入。新增`task-detail.test.mjs`通过受控DOM/transport执行真实app函数，先在10项中得到8项实际失败、2项保护通过：四种解析/索引终态标签不符，四种两链cancel/retry替换输入节点。修复为当前授权详情只读字段刷新、task action读取保留表单后通过；再补两链授权页移除/身份切换动作保护，共12项通过。夹具初始DOM属性映射错误单独修正，不作为产品红测证据。
- 后续P2为保留表单时保存按钮仍可用、submit捕获旧`can_edit`：新增8项actual-app DOM回归连续两次真实失败，再修复为按钮与submit均读取当前授权同ID行，submit同时检查身份epoch、当前详情和live form。覆盖两链editor→reader拒绝PATCH、reader→editor不重建表单即可保存、列表移除和旧身份表单拒绝PATCH；原输入、草稿和值以及保存按钮节点保留。`task-detail.test.mjs`最终20/20通过，state模块未因该修复变更。
- Java仓库在最后静态源码修改后运行`node --test ui-tests/*.test.mjs scripts/check-secrets.test.mjs`，72/72通过（61 UI、11 checker），0失败/取消/跳过；app和详情测试语法检查通过。Java Node检查不认证Java后端源码或coverage。
- 实现者未运行Maven、真实Java服务/浏览器、provider/Milvus、完整RAG golden、移动端或生产验收。未启动或修改现有服务；HTTPstub不会读取业务数据。索引完成后问答仍禁用，RAG答案acceptance不可执行，不记为通过。
- 独立审查详情P2修复待复核，最终真实Java浏览器验收仍待负责人执行；[REVIEW](changes/0003-text-index-publication/REVIEW.md)为IMPLEMENTATION。源码安全扫描须在负责人明确暂存后完成；本次secret checker测试不能代替最终index/历史扫描。

## 0002文本上传历史基线 · 2026-09-06（不认证当前增量）

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


## 2026-09-07 源码提交检查

用户授权更新独立前端仓库。包含既有0003索引UI依赖、0004工作流程导航和0005本地预览；全量109/109、JavaScript语法与diff检查通过。0004/0005独立审查及浏览器证据见对应变更verification.md，库内远程原文件与生产验证仍未完成。暂存后执行凭据扫描；最终推送结果以远端提交为准。
