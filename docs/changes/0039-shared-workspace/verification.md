# Verification

发布后更新：2026-10-08 23:54:52已按获批体验版上线并保留免登录。8个只读路径/188 PDF资产逐项验证，浏览器显示10份原资料和组织共享全库。没有主动提交模型请求，未认证真实回答质量；用户新反馈低相关内容混入正在诊断。见后端0053 deployment-verification。

## 本次已实际完成

- 新增shared-workspace.test.mjs的4项先在旧实现全部失败，再由本次实现全部通过：长问题/废弃范围不发送、1000份全库计数、40条真实typed引用及恶意URL拒绝、HTML撤去范围控件和问题maxlength并保留退出。
- 原知识问答双来源测试继续校验同版本PDF第2页和视频3200–7800ms、完整原件哈希、Blob释放；请求更新为固定全库。
- 原reader相关用例改为组织共享成员可编辑，继续保留当前资料、任务、发布版本、显式动作、秘密清理和迟到响应隔离断言。没有删除或跳过用例。
- 两个真实loopback代理新增知识来源第33/1000号正例，保留非法编号、额外路径及外部未登录拒绝。
- 最终完整命令：`PATH='/Library/Developer/CommandLineTools/usr/bin:/opt/homebrew/bin:/usr/bin:/bin' node --test --test-concurrency=1 ui-tests/*.test.mjs tests/*.test.mjs scripts/check-secrets.test.mjs`，492 tests / 492 pass / 0 fail / 0 skipped，31.237秒。
- 最终`npm run check`通过，`git diff --check`退出0。

## 环境与失败记录

首次普通沙箱禁止临时127.0.0.1监听，代理用例listen EPERM不计产品失败；随后获准只用本机替身监听。一次默认并行完整490项中488通过，外部音频代理10ms夹具和媒体DOM等待两项未通过；没有放宽期限/断言，按单文件并发运行最终492项全部通过。

## 未认证

没有打开用户真实页面发起模型请求；没有浏览器视觉验收、实际Java新合同联调、真实模型质量或生产发布。本轮真实模型HTTP为0，后端0052旧14/20停点保持。源码和测试本地修改，未提交、推送或部署。
