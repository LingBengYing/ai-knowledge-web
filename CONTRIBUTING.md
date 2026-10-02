# Contributing

先按顺序读对应版本化变更的intent、spec、plan、REVIEW，再读 [AGENTS](AGENTS.md)及项目文档。当前主线为 [0006文本证据问答](docs/changes/0006-grounded-answers/)。保持原生技术栈与现有行为，功能更改需要明确需求和新spec，不因分仓自行重做UI。

```bash
npm run check
npm test
npm run check:secrets
git diff --check
```

无npm第三方依赖，不需要安装或生成lockfile。Node22可直接运行。新行为先给失败测试，再实现并跑完整对应测试文件；不得删/跳过/放宽失败测试。

每轮先完成一条具名正常路径，非阻塞权限增强、异常组合和性能工作后置；不移除已有鉴权、证据校验或无证拒答。`apply_patch`上下文匹配完整物理行；失败后重新读相关完整行，不重复使用截断前缀。

前端状态测试不能代替Java权限测试；HTTPstub证明代理协议与负例，不证明真实Java/浏览器/生产就绪。0006已验证固定合成PDF的本机有据回答、服务器来源回读与空库拒答，完整selected-set另有自动化回归；模型/向量协议夹具不认证真实provider/Milvus质量。任何新的RAG行为必须记录对应acceptance、浏览器证据及未验证边界；只有确实无RAG行为变化的变更才记acceptance不适用。多模态网页与生产仍按后续主线推进。

发布前先核对remote与已有历史，不强推；暂存明确文件，扫描index/worktree/history。保留源码来源，不提交旧项目历史、运行数据、个人路径或秘密。独立审查的结论和实际CI要绑定提交，不自动继承旧版证明。
