# 合同

知识页列表默认只列active，并提供简洁的“已删除”入口。列表/详情可删除，弹窗说明“可恢复，不删除原始资料”；明确确认后一次DELETE，服务端成功回读后刷新。已删除页详情标注状态、隐藏编译更新、提供恢复；历史版本仍可查看。关系/总览/搜索只用active页，已删除列表不污染active缓存。

API与后端0058一致：list `state=active|deleted`；页DTO新增state/lifecycle_version，旧服务缺字段按active/0兼容。DELETE `/v1/wiki/pages/{id}?version=N&lifecycle_version=L` 无body，POST `/{id}/restore` JSON `{version,lifecycle_version}`，返回页DTO。历史视图删除前取最新页，以服务端双CAS防陈旧写。写入busy、防重复、取消确认无请求；失败不自动重试，不假报成功。保留身份与精确代理白名单。
