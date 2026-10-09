# Web0045 生产发布

2026-10-09 16:44:25 +08，负责人授权后与Java0059一起发布 `20261009-document-formats-0059`。入口使用实际0058生产定制server叠加格式白名单和限定原件下载头，不改模型/检索配置或免登录身份。

最终包SHA：`389429bdc16b0ee57ba3843b4ab14971450855725e4c63e85ec52322e788f3ad`。225个运行文件完全匹配manifest；215文件与原版字节相同。制品与最后修复相关测试见 [deployment-preparation.md](deployment-preparation.md)。

公网HTTPS验证开启，23项只读检查通过，11份运行静态资源逐SHA匹配。原件代理固定附件保护头已通过105项直接回归及实际生产入口280项检查。实际浏览器在新标签中打开资料页→导入窗口，确认以下accept值：

`.pdf,.properties,.html,.vtt,.csv,.msg,.markdown,.eml,.ppt,.docx,.doc,.txt,.pptx,.mdx,.xls,.odt,.md,.xlsx,.xml,.epub,.htm,.png,.jpg,.jpeg`

旧标签reload曾超时且仍显示旧文案，不能当新版证据；新标签确认新文案“文档 / 图片”及全部后缀后已保留。截图保存在工作区忽略目录 `.local/release-0059-20261009/production-upload.png`。浏览器只打开窗口，没有选文件、上传、索引、编译或问答。

实际生产Linux以同Java包隔离解析21格式全部通过；数据库schema33不变，切换前后95表/8数据文件、所有配置保持，三服务active/NRestarts0。完整RAG readiness旧503及历史后端测试例外未关闭。无Git推送、本轮发布模型请求0，其他用户操作不属于本次验收调用。
