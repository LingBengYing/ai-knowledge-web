# 本地验证

日期：2026-10-13。

## 行为与证据

- 先增加三项实际问答历史 UI 回归，旧实现实跑 0/3：缺少结构排版、来源未折叠分组、旧内部编号标记仍显示。
- 实现后另加代码块/普通术语/编号步骤/非正式引用保留回归；四项新增行为通过。
- 首轮直接回归 106/107，唯一失败为新增测试把合成输入的中文句号误写成英文点。精确修正断言后，新增第四项一起运行 108/108；旧测试断言不变。
- 正式 `[n]` 链接只来自当前答案已验证引用集合。未知编号、自由 URL、HTML 和代码内编号不生成链接；任意 HTML 保持转义。
- 来源按资料 ID 和版本 ID 分组；同名不同资料及同资料不同版本分开，保留四条测试引用的各自定位。
- 历史答案的显示处理不改 `result.answer`，保存草稿仍包含完整原文；SSE 预览、终态来源发布和历史恢复旧回归通过。
- 独立审查发现括号文件名误当内部标记，例如 `[source-1].txt` 和 `(source-2).pdf`。新增实际 UI 回归先红，再限制隐藏条件：紧邻词字符、路径符或扩展名则保留；中文参数、英文相邻词同样保留。修复后直接回归 109/109，修改模块语法和 diff 通过。此修复后未再次运行整套回归，下面 538/539 保留为修复前完整执行记录。

## 执行命令

```sh
node --test --test-name-pattern='answer-focused presentation|answer sources collapse|historical model-only source markers' ui-tests/wiki-workspace.test.mjs
node --test ui-tests/wiki-workspace.test.mjs ui-tests/knowledge-agent.test.mjs ui-tests/knowledge-conversations.test.mjs ui-tests/answers.test.mjs
node scripts/check-syntax.mjs
git diff --check
node scripts/check-secrets.mjs
node --test --test-concurrency=1 ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs
node --test --test-name-pattern='development sound build and query retain explicit processing deadline' tests/sound-transport.test.mjs
```

首次完整串行共 539 项、528 通过、11 失败；失败全部来自秘密扫描测试的临时 Git 夹具，默认 Git 入口返回 69，尚未进入待测行为。指定本机已可用的 Command Line Tools Git 后原命令复跑 538/539。

第二轮唯一失败：`tests/sound-transport.test.mjs:116` 的开发声音代理用例，普通读取设置 20ms，原本应先检测响应超限并返回 502，本轮先到截止返回 504。该用例及其代理实现本阶段完全未改；第一次完整运行该项已过，单独用原断言复跑 1/1 通过。没有扩大期限、跳过或删除测试，完整运行的失败保留。

语法、diff 和当前已跟踪工作树秘密扫描通过。没有新模块或依赖，无需新增静态资源白名单。未运行历史秘密扫描，不把当前扫描称为全历史通过。

## 边界

主任务最终补验（文件名修复后）：完整540项537过/3失败。`dev-server.test.mjs`的摘要及附件读取出现短截止先504而非502；`wiki-transport.test.mjs`短截止前计数3/4。相关测试及代理与HEAD相同，三项按原断言隔离复跑3/3通过，不抹去完整运行失败。最终当前扫描/diff通过。

实际浏览器已见证：真实前端加载纯合成历史，安全正文排版、默认折叠2份资料3处引用、展开同资料两片段分组、点击正文[2]回读正确字符定位/原件、返回和刷新恢复。它只验证显示与来源交互，不是模型生成质量。

本任务仅本地 UI 实现和合成回归，不发模型请求，不改生产、不提交推送。前端仅改变呈现，不推断结论、生成总结或放宽来源合同；真实模型综合质量尚未验收。
