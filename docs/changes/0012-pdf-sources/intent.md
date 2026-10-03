# Intent：扫描 PDF 的按页来源

状态：IMPLEMENTATION。沿已批准多模态主线补上扫描 PDF 上传、文字问答与原 PDF 回看，配合后端0023；页面验收由用户负责。

点击 PDF 答案引用后先回读服务器证据，再读取相同 document/revision/SHA 的已保存 PDF，按服务器页码打开。复用已有原文件接口与代理，不从模型文字生成链接。
