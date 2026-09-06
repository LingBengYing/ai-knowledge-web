# Source Provenance

导出基线：[ai-knowledge commit 85aa6aa77f8b2977145902ebd7225bfd2d3ae030](https://github.com/LingBengYing/ai-knowledge/tree/85aa6aa77f8b2977145902ebd7225bfd2d3ae030)，2026-09-06。这里只记录前端来源，不复制Java、Python、数据库、运行配置或原Git历史。

## 0001历史发布基线（不认证当前UI）

0001发布时六个`public/`文件逐字节来自该提交的`src/main/resources/static/`同名文件，未做UI行为变更。以下是旧版本摘要，0002后已不适用于当前六文件集合：

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

## 0002文本上传显式同步 · 2026-09-06

本变更先在独立前端`public/`实现，再显式复制到Java仓库`src/main/resources/static/`；与Java `docs/changes/0003-text-ingestion`契约对应。不是从旧85aa6aa重新导出，也不引用尚未发布的Java提交。最终两仓库提交与独立验收由发布记录绑定。

| 当前文件 | SHA-256 |
| --- | --- |
| api.mjs | 0ac55f0895cb9416f4dae137eb2480e1320a2dcb5b3c95d3ecf6b1e50b4bcbad |
| app.js | 7ec8ed28afd6e948338cb9cc04a8735670820248fa01b7e7ef529ded58a966a4 |
| index.html | 24f4f0082ddb4961e9d41cdf6ceec35d9a162a9d985b0beee37752d076ea9355 |
| notices.mjs | 8e43264e4f7e52bca45f8893bd797f66e0ec2ad7ae5a5fcffe142b070da61a80 |
| styles.css | 66e9b29f7815841579af33e0f10e9e2d979b8f6280d2cf8e81af0867d6285829 |
| workbench-state.mjs | cf1df7aa3f323fa43ea5dcb366c3eee46d354cdc22a9d475fca7a23ba3330329 |

新增`ui-tests/ingestion.test.mjs`在两仓库只有import路径不同，原四个20项UI测试与两份secret checker文件未改动。代理新增精确上传/任务路由和独立上传预算；没有复制Java实现、原文、数据库或凭据。

这不是自动同步机制。后续UI变更应明确哪个仓库负责维护并更新来源/差异说明，不能将本页摘要当作未来源码认证。
