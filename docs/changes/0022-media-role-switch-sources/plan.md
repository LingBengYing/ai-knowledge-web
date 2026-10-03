# Plan：一个来源回调及真实DOM回归

状态：LOCAL_VERIFIED。A拥有app.js窄回调与新增DOM测试；root拥有正式工件、操作指南和共享最终验证。实际同一DOM RED→GREEN、完整431及syntax通过；当前交接以manifest为准。

先新增模拟实际旧视觉答案→来源cap独立开启→原metadata/原字节SHA→Blob读取的DOM测试；当前错误canReadImage产生业务RED。RED保留后改回调，直接回归再完整syntax/full。新增测试不得假实现产品或删改旧断言。其他retrieval-only范围缺口留下一主线，不并行实现。
