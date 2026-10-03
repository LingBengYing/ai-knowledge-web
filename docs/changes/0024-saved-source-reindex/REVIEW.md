# Review：入口可用与版本事实

状态：LOCAL_VERIFIED；本机实施和实际回归通过，未部署。当前证据见[verification](verification.md)。下方设计及早期记录保留历史语境。

旧appendIndexControl将任何latest job显示为“索引任务”，不能承载再次重建；新增独立入口保留旧任务入口。旧active优先状态和“未发布索引”失败文案会误导重建用户，需表达本次任务和旧版本分别存在。成功不能仅比较revision，因为同材料重建的parsed revision不变；publication_id才是本切切换事实。旧回答current来源会失效，应提示重查而非显示旧来源成功。

代理A先在旧DOM落新增可编译用例，root实跑缺入口RED；无API符号的编译失败、夹具环境错误不计业务RED。后续只按实际结果更新，完整435及原模型配置、召回范围和来源校验保持。
