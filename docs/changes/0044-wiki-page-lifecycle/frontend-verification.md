# 前端直接相关验证

2026-10-09，本切本机源码已完成。实际 Java/浏览器验证由协调者单独记录；本文件不认证生产发布。

## 行为

- 知识页列表与详情提供删除；页面内确认明确“可恢复，不删除原始资料”。
- `#/knowledge-deleted` 独立读取 deleted 集合，提供恢复；active 集合单独缓存，首页、侧栏、正常搜索和共同来源关系不混入已删除页。
- 当前/历史详情保留原文与版本读取；已删除页显示状态，隐藏编译入口，直接访问编译地址也不出现编译表单。
- 删除与恢复均先读取当前知识页，再携带内容版本与生命周期版本；旧 DTO 的缺省生命周期为 active/0。
- DELETE 无请求体，restore POST 为 JSON。开发与外部代理都保留原身份/Origin/大小/超时边界，无自动重试。

## 红绿与回归

1. 新增 API、DOM 3 个用例先失败：`deletePage` 缺失、删除入口缺失、已删除页仍可编译。
2. 新增 HTTP 用例首次因 sandbox 禁止 loopback listen 返回 EPERM，属于运行环境，不计产品 RED；允许本机监听后执行通过。
3. 首次完整三个相关文件 54/55：旧白名单用例把全部 page DELETE 当作不支持。按 0058 新合同保留该 URL 的无 CAS 拒绝断言（改为 400），并保留 PUT 错误方法 405 断言；不是删除失败用例或放宽服务端校验。删除代理现在精确要求两个安全整数 CAS 参数。
4. 最终相同三个完整文件 **55/55 PASS**，零失败、零跳过：

```sh
node --test ui-tests/wiki-workspace-api.test.mjs ui-tests/wiki-workspace.test.mjs tests/wiki-transport.test.mjs
```

`node scripts/check-syntax.mjs` PASS；`git diff --check` PASS。已有 Agent、模型设置、原始来源与草稿用例包含在这次 55 项内且通过。没有修改问答生产逻辑，没有调用模型，没有推送或部署。未重跑全仓回归，先前其他文件的已知失败不据此关闭。

## 修改边界

主要修改 `public/wiki-workspace.mjs`、`public/wiki-workspace-api.mjs`、`public/wiki-workspace.css` 与 `scripts/wiki-transport.mjs`。两代理仅增加知识页 DELETE 的 bodyless 分类；`external-server.mjs` 已有其他任务的 Wiki 根入口设置保留，未覆盖。
