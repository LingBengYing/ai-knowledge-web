# Plan

1. 先增加问答/来源与代理合同的失败用例。
2. 独立问答Module隐藏请求/响应校验及epoch；页面接入全部/完整所选范围、结果和来源状态。
3. 精确扩展本地代理；复用Java真实合同、现有API客户端和鉴权，不新增云调用。
4. focused测试后跑`npm run check`、`npm test`和diff检查；启动隔离联调环境，浏览器实际提问与来源回读。
5. 更新README、AI_CONTEXT、API_CONNECTION及验证记录，说明实际可用部分与未验证项。

2026-10-02执行偏离：正常路径浏览器发现parsed终态需手动刷新列表及can_answer旧占位阻断单行入口，均纳入本切修补；未造权限或改写服务器状态。补充空库拒答提示。最后源码已完成本机浏览器与139项回归，详见verification；真实质量和生产不是本切验收范围。

Ownership：主线程负责工件和页面集成；代理worker仅负责dev-server及其测试；问答worker仅负责answers Module及其测试。共享工作树不回退他人修改。Git提交/推送由专门任务负责，本轮不执行。

Backlog：多模态上传/问答/typed媒体来源、持久摘要与查询附件网页；真实provider/Milvus质量；生产同镜像验收与部署。非阻塞权限增强、性能和组合异常后置。
