# Contributing

先读 [AGENTS](AGENTS.md) 与当前版本化变更工件。保持原生技术栈与现有行为，功能更改需要明确需求和新spec，不因分仓自行重做UI。

```bash
npm run check
npm test
npm run check:secrets
git diff --check
```

无npm第三方依赖，不需要安装或生成lockfile。Node22可直接运行。新行为先给失败测试，再实现并跑完整对应测试文件；不得删/跳过/放宽失败测试。

前端状态测试不能代替Java权限测试；HTTPstub证明代理协议与负例，不证明真实Java/浏览器/生产就绪。相关RAG acceptance此次无行为变更记不适用，未来新增问答必须单独验证服务端引用、拒答和完整selected-set。

发布前先核对remote与已有历史，不强推；暂存明确文件，扫描index/worktree/history。保留源码来源，不提交旧项目历史、运行数据、个人路径或秘密。独立审查的结论和实际CI要绑定提交，不自动继承旧版证明。
