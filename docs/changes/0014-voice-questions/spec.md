# 行为合同

- VW-01：连接成功、当前证据mode的answers/sources及独立`voice_questions`能力启用时，可选择一个现有支持的非空≤20MiB音频文件；不要求query_attachments或visual/video。先校验再读取，复用音频MIME与canonical base64。
- VW-02：显式“转成文字”POST `/v1/voice-questions`，正文只有filename/media_type/content_base64。完整原字节读取并计算SHA；核对响应8字段、固定policy、版本/时长、原SHA、transcript UTF8≤65536及完整SHA后显示可编辑纯文本预览。
- VW-03：确认前保留已有手工问题，不调用问答；“用作问题”是明确替换动作，验证预览满足原非空/字符/UTF8 4096-byte合同后填入问题框并reset旧答案。保留完整scope与mode，不自动选audio证据，不自动加入检索附件；用户照常点击提问。不会截短识别文字。
- VW-04：转录与问答互斥、防重复；取消、换文件、身份/scope/mode/问题变化、离开问答/pagehide使旧结果失效且abort等待，迟到读取不发送请求、迟到转录不覆盖新问题。取消不保证撤回上游请求，POST失败不自动重试，401沿既有身份处理。
- VW-05：两个代理新增精确静态voice-question.mjs与POST（无query），独立28MiB JSON、180秒、2在途。保持普通JSON128KiB/10秒、附件与问答既有期限、Host/Origin/认证及来源回读不变。

必要验收覆盖文件/完整SHA、完整尾部文字、手工编辑与明确替换、范围/模式保留、随后旧问答与引用、读取取消/迟到、重复、能力关闭和两个真实HTTP代理。本机DOM/loopback证据不认证浏览器或真实ASR质量。
