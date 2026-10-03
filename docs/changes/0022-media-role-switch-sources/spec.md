# Spec：旧来源独立于新生成能力

状态：LOCAL_VERIFIED。实际红绿与未验范围见verification。

connected且visual_sources声明实际可用时，旧视觉source经过完整答案/locator/版本/geometry及原字节SHA核对后可读取原图/Blob。visual_answers关闭仍不能发新视觉问题，不伪造答案cap。断线、身份改变、版本或SHA错误、visual_sources缺失仍拒绝；无自动生成、解码、重试或任何模型请求。

旧text OCR、音频、视频、sound、video-av来源规则不变。旧430项测试和断言保留；新增DOM正常链先真实RED，修复后完整npm check/test。后端0034真实HTTP互补，DOM不是部署页面验收。
