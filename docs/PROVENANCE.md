# Source Provenance

导出基线：[ai-knowledge commit 85aa6aa77f8b2977145902ebd7225bfd2d3ae030](https://github.com/LingBengYing/ai-knowledge/tree/85aa6aa77f8b2977145902ebd7225bfd2d3ae030)，2026-09-06。这里只记录前端来源，不复制Java、Python、数据库、运行配置或原Git历史。

六个`public/`文件逐字节来自该提交的`src/main/resources/static/`同名文件，未做UI行为变更：

| 文件 | SHA-256 |
| --- | --- |
| api.mjs | fb1173ebd5f443458a2eef1fa412a7ca84b088ac3a0291967214a5f780e390ed |
| app.js | 32f185d906a391f3fa8a220d7f682add57420a59a9bd2e4b8c23b6521d379cf5 |
| index.html | bd9b710d9a08486900f2cde59cdb132e1feb1d58e36ea9150edc434357dabbb1 |
| notices.mjs | 8e43264e4f7e52bca45f8893bd797f66e0ec2ad7ae5a5fcffe142b070da61a80 |
| styles.css | 482f447ddb95738a954d79891aa9f0df05a95b4838a6d858f15b711d6d42bd97 |
| workbench-state.mjs | 5805823c8ffe4c992cfafde179a5169afc3cb56752630e4904b8ed775e8fdd07 |

原四个`ui-tests/*.test.mjs`的20项测试仅把资源路径从`../src/main/resources/static/`改为`../public/`，未修改断言。

`scripts/check-secrets.mjs`和其11项CLI测试逐字节复制同一提交。摘要分别为`aa4687db8272dbf91b4afdf5579d5732859f69cf757bb4ee99e4f8487f8acdc0`、`cce159e52987f9995aee2cc3511898a2b5616aabea2d472f060adf3d66ea5337`。新开发代理、代理测试、Node配置、CI与文档属于此次独立前端发布。

这不是自动同步机制。后续UI变更应明确哪个仓库负责维护并更新来源/差异说明，不能将上述摘要当作未来源码认证。
