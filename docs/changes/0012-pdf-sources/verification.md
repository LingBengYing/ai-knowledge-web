# Verification：PDF按页来源

2026-10-03本机验证，用户拥有网页验收；未访问浏览器、调用真实模型、修改部署或Git索引。

- RED：新PDF来源协议6项中5失败/1既有关闭能力路径通过；真实app DOM 50项中原48通过/新增2失败。
- GREEN：新增协议6项及真实app DOM 50项全部通过。覆盖PDF引用→服务器来源→原文件metadata→完整SHA/大小/MIME→Blob、绑定失配不读内容、关闭后的迟到读取与URL释放；真实app按服务器第2页构造预览/打开/下载，离页清除。上传只在pdf_ocr_upload启用时声明逐页OCR。
- `npm run check`通过；`PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH npm test`完整245项通过，失败/取消/跳过均0。`git diff --check`只读检查通过。
- 生产改动仅`public/answers.mjs`、`public/app.js`、`public/index.html`；无新代理路由、媒体格式/传输限额或依赖。

本前端测试使用合成协议字节和DOM Adapter；不认证PDF像素、浏览器页码跳转支持、真实OCR/云质量。后端0023真正合成PDF/Tesseract验收另列，不互相替代。当前尚未发布，公网/页面验收仍由指定任务与用户执行。

日志位于本地`.local/pdf-sources-{red,app-red,targeted,syntax,full}.log`，源码与日志指纹在工作区`.tools/scanned-pdf-verification`及后续冻结交接，不提交运行日志。
