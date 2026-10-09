# 0044 生产前端制品

2026-10-09，负责人已明确授权“更新生产吧”。本记录仅认证制品准备与本机入口兼容；实际上线结果由协调者单独记录。

## 制品与保留边界

- 基线为0057已发布包 `d1417b676c2f8edb6151bef8deb32a7a48e285a8a2162a3730f92e0bff862800`，其225文件及manifest先逐SHA核对。
- 新目录：工作区 `.local/release-0058-20261009/`。
- 最终 `frontend.tar.gz` SHA256：`4a3cc1fbbc787a49331bd9582c6eb053b66c9a3795888d58da35eb5cc2e3a9d2`。
- `frontend-files.json` SHA256：`7d16860f1a95b806d851769ab82e856f5d5b0df2d6a4b6ae9acddb412169e8eb`。
- 定制入口SHA256：`325b469c5dfc61304da7f088e1588813fd2a8a40fc444fac1acb4ad19949c526`。

225个运行文件中，仅 `public/wiki-workspace.mjs`、`public/wiki-workspace-api.mjs`、`public/wiki-workspace.css`、`scripts/wiki-transport.mjs` 叠加0044；定制 `scripts/external-server.mjs` 仅把知识页DELETE纳入bodyless分类。反向替换该单行后与0057生产入口逐字节相同，其余220文件逐SHA不变。免登录签名、共享身份、Agent、模型配置入口、PDF资源与原运行参数均保持，无新增环境配置。仍使用 `node scripts/external-server.mjs`，不发布开发server。

## 验证

制品内所有JS语法检查通过。`test-frontend-entry.mjs` 实际导入待发布定制入口，loopback固定合成身份下 **228项通过**：匿名Wiki首页/旧管理页、各Wiki模块、188个PDF资产逐SHA、共享会话、原Agent四接口、Wiki编译/草稿/版本来源、已删除列表、双CAS删除与恢复，以及Origin/缺CAS/DELETE带body/历史版本删除拒绝。11个预期业务HTTP转发，其他负例未转发。

日志与完整结果位于制品目录 `entry-verification.log`、`entry-verification.json`、`frontend-bundle.json`。新增真实模型HTTP 0；准备worker未连接或写服务器、未推送。没有重跑无关全仓长测，旧异步回归失败不因此关闭。本记录不代替真实后端迁移、服务切换、页面联调或模型质量验收。

## 归档元数据修正

发布预检发现首次macOS tar附带AppleDouble `._`文件，尚未切换生产。首次包按原字节保留为 `frontend-first-metadata.tar.gz`，SHA256 `135705afdf31c03fa6b10f84bfb2a73b2cfed663dc016df8393c52587dcc16bc`，不再用于发布。归档命令固定 `COPYFILE_DISABLE=1 /usr/bin/tar --disable-copyfile` 后重新生成最终包，没有修改已测试的225个源文件或manifest。

实际使用CommandLineTools Python `tarfile`独立核对：regular文件集合恰好225项且无重复，与manifest路径集合完全相等，无任何 `._`，无链接/其他特殊条目，每个归档文件正文SHA与manifest一致。结果见制品目录 `frontend-archive-verification.json`。系统 `/usr/bin/python3` 首次因Xcode许可报错，未代用户接受许可，改用现有CommandLineTools解释器完成检查。
