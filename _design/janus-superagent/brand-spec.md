# JanusX 原型视觉依据

本演示为独立设计提案，产品事实来自当前仓库，不表示生产功能已交付。

- Logo 使用 `resources/icon.png`，以原始 PNG 的 data URL 内嵌到 HTML；不重新绘制品牌标志。
- UI 参照仓库已有 `design/run-status-assets/titlebar-planche.png` 与 `titlebar-dark.png`。真实截图已检查；原型沿用顶部 Island、项目工作区和右侧工具区，不将模拟工作台称为生产截图。
- 双眼结构参照 `src/renderer/src/components/janus/JanusEye.tsx`；这是已有代码原生标识的复用。
- 纸面／深色配色来自 `design/run-status-exploration.html` 和 Janus Planche 样式：纸面 #efe4c5、墨色 #1c343b、朱红 #d43d2a；深色 #151517、文字 #fafafa、强调 #ff784a。颜色通过 CSS 变量集中定义。
- 字体沿用现有 Windows 工作台的 Segoe UI / Microsoft YaHei，代码与标识使用 Consolas。页面不加载网络字体或运行时依赖。
- 视觉目标：笔记本距离阅读的架构解释与桌面交互演示。整体框架强调职责，阶段路线强调进入下一阶段的验证条件，工作台强调用户输入和事项归属。
- 第四版保留四页，默认打开交互页的启动前界面。中央启动按钮与 Island 进入同一个 Janus；启动后 Island 只显示通知。左侧工作区切换注意力，中央对话不提供事项／分支选择器，Janus 自动准备工作分支。
- 右侧升级为 Worker 状态视图：运行／排队／空闲计数、引擎、工作目标、阶段条和异常状态；运行脉冲支持减少动画偏好。分支与目录折叠到详情，选择卡片不改变消息归属。正常反馈续接原 Session，异常恢复单独演示。
- 建议分期：MVP 双入口、通知、单工作区、多持久会话、单运行槽位、自动分支准备、异步输入、归属与澄清、轻量过滤和链式读取；二期多工作区、分支管理增强与原生联动；三期监督恢复及按需来源。并发单独评估，存算分离和跨设备后置。
- 可维护源码为 `index.template.html`、`demo.css`、`demo.js`；用 `node _design/janus-superagent/build.mjs` 生成单文件 `index.html`。历史版本保留为 `index-v1.html`、`index-v2.html` 和 `index-v3.html`。
- 所有 Worker、代码修改、验证结果和恢复效果均为预设模拟。不会调用模型、运行命令或写入真实项目。浏览器仅保存演示状态。
