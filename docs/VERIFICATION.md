# Verification

## 本地验证 · 2026-09-06

- 最终 `npm test`：43项全部通过，0失败/取消/跳过。包含原20项UI行为、原11项secret checker、12项新增开发代理测试；主线程和独立审查分别重跑通过。
- `npm run check`：`public`、`scripts`、`tests`、`ui-tests`全部JavaScript语法检查通过。无第三方依赖、无构建产物；`public/`即交付静态资源。
- 代理红绿：先运行HTTP测试得到`ERR_MODULE_NOT_FOUND`（实现缺失）；实现后真实HTTP首轮8/9，静态POST负例因缺Origin先被403拒绝，补齐同源Origin后保持原405断言通过。新增deadline覆盖上传及流响应、Cookie/身份隔离测试后完整42/42。
- 沙箱禁止loopback监听产生的EPERM已单独排除；在获准本机HTTP环境重跑，不把工具环境故障当作应用失败或跳过测试。
- 只读复核指出“丢弃显式Authorization后仍转发有效Cookie”会改变后端的凭据优先级；已改为任何Authorization先400拒绝，并在真实HTTP负例中覆盖单头/重复头携Cookie且后端零调用。修正后完整42项与语法检查再次通过。
- 静态六文件与secret checker两文件摘要见 [PROVENANCE](PROVENANCE.md)；最终独立复核与提交后的完整历史扫描由发布步骤记录。
- 审查修复后保留全部原断言：Authorization 与 Cookie 并存一律400且零转发；单文档GET不冒充后端接口，405零转发、PATCH正例通过。新增前端80端口拒绝回归先出现 `Missing expected exception`，修复两处配置入口后完整43/43通过。
- 独立只读审查 PASS，限本地开发源码。代理与测试冻结SHA-256分别为 `2dd36e28cb0934f739c9f606607db0fabf5aa740b8e05e5250f72bd1b396c2df`、`da9a4383b672c051a5dbf17653d53301d53f96a4283d5e5d948d330af11f9ae3`；13份Markdown的相对链接均可解析。
- 最终源码实际启动：前端18085连接已运行Java18084，live200、ready503原样保留、config显示 `management_slice` 和原能力集合。新浏览器页实际加载成功，显示owner身份、4份合成资料、目录/标签与禁用上传/问答按钮。本次仅只读验收，没有修改现有资料，也未重做JWT交换、全部交互或移动端回归。

## 验证边界

HTTPstub验证精确Host/Origin/fetch-site检查、身份/会话头allowlist、JSON方法/路由、静态allowlist与symlink、限长、总deadline、后端故障和3xx不跟随。不调用真实模型、不触碰数据库；UI模块测试不等于本次真实浏览器验收。

本次没有RAG行为变化；检索/回答golden acceptance不适用，不能记录“通过”。完整Java迁移、真实Milvus/provider、多模态与生产gate保持未完成。

## 发布状态

独立实现、本地测试、只读审查和真实Java浏览器加载已完成。提交后的远端SHA/树及 [GitHub Actions](https://github.com/LingBengYing/ai-knowledge-web/actions) 按实际发布结果核对；CI配置本身不是通过证明。本文件不认证未来提交，静态来源见PROVENANCE，完整源码由Git提交绑定。
