# Pi Desktop 设计与架构约束规范

本规范作为 **Pi Desktop** 在现有雏形基础上进行 UI、字体、布局优化及原生功能复刻的统一约束基准。

---

## 一、产品边界：Pi 原生能力复刻

1. **只复刻 Pi 原生能力**：
   - 底层会话、模型、工具、扩展、技能、MCP 发现与持久化完全依托 Pi CLI（`--mode rpc`）与 `~/.pi/agent`（或 `PI_CODING_AGENT_DIR`）。
   - 不引入非原生流程：不自建审批弹窗流、不自建 MCP 管理后端、不自建计划模式、不自建子代理编排。
2. **原生状态对齐范围**：
   - 会话生命周期与连接状态（启动连接、断线重连、流式运行、中断 `abort`）。
   - 增量流式响应（正文 Markdown、思考块 `ThinkingBlock`、工具执行 `ToolActivity`）。
   - Pi 原生已接通的状态与指令：运行/排队/自动重试/压缩提示（`status`）、扩展状态栏（`commandStatuses`）、Bash 执行输出展示（`bashExecution`）、斜杠命令（`commands`）与手动压缩（`compact`）。
   - 清理无实际行为的空壳入口（如无对应原生功能的占位按钮）。

---

## 二、Astryx 样式与主题约束

1. **单一主题管线**：
   - 使用 `npx astryx experimental theme editor` / `defineTheme` 生成并编译本地主题（`themes/` + `src/themes/`），通过 `npx astryx theme add` 纳入 `src/astryx-themes.ts`，在 [main.tsx](file:///Users/fansicheng/Projects/Pi/src/renderer/src/main.tsx) 中唯一引用，禁止并存两套互不关联的主题入口。
2. **组件优先，拒绝杂乱 CSS**：
   - 布局与间距统一使用 `@astryxdesign/core` 组件（`AppShell`、`Layout`、`SideNav`、`SideNavSection`、`SideNavItem`、`HStack`、`VStack`、`ChatLayout`、`ChatMessageList`、`ChatComposer` 等）及其 props（`gap`、`padding`、`maxWidth`、`width`、`minHeight` 等）。
   - 禁用原生 `<div>`、裸 `<button>`、裸 `<svg>`（非品牌标识图标统一用 `@heroicons/react` + `<Icon />`）。
   - 尽量消除页面级 `className` 与内联 `style={{}}`；局部组件外观（如 `app-shell`、`side-nav` 透明背景、选中态高亮）由主题定义或组件属性承担。
3. **全局 CSS 白名单**：
   - `src/renderer/src/styles.css` 仅保留电子窗口与平台原生的必要声明：
     - macOS 窗口拖拽区域（`-webkit-app-region: drag / no-drag`）与窗口根容器 `100%` 尺寸锁定。
     - macOS `vibrancy: 'sidebar'` 半透明基底混合与滚动条/字体抗锯齿设置。
     - 全局 `::selection` 选中高亮与 `prefers-reduced-motion` 兜底。
4. **交付红线**：
   - `npm test` 全部通过。
   - `npm run build` 类型检查与构建通过。
   - `npx astryx doctor --built src/renderer` 保持 **0 fail**，并持续清理 `built-astryx-purity` 警告。

---

## 三、字体与中文排版约束

1. **三类字体栈（在主题 Token 层统一声明）**：
   - **UI / 正文（`--font-family-body`）**：`'Figtree', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif`
     - 西文与数字优先使用内置 `Figtree`，简体中文稳定回落到系统 `PingFang SC`。
   - **标题（`--font-family-heading`）**：同上字体栈，标题字重收敛在 `500`（`medium`）与 `600`（`semibold`），避免中文字体过粗发糊。
   - **代码与命令行（`--font-family-code`）**：`'SF Mono', ui-monospace, Menlo, Monaco, 'PingFang SC', monospace`
     - 覆盖 `CodeBlock`、路径、斜杠命令、Bash 输出与代码块。
2. **字号与层级规范**：
   - 正文与列表主文本保持默认 `body` 大小，通过 `weight` 与 `color="secondary"` 区分主次，不随意将主要阅读文本缩为 `supporting`。
   - `supporting` 仅用于元信息、时间、标签说明、统计指标项。
   - 所有动态数字（轮次、步数、Token、百分比、耗时、速率）开启 `hasTabularNumbers`，避免流式刷新时跳动。
3. **页面标题尺度统一**：
   - `HomeScreen` 与空状态主引导使用语义一致的展示标题；功能页（`CustomizeScreen`、`CustomizationDetailScreen`）使用 `Heading level={1}`。
4. **截断与防溢出**：
   - 单行标题、路径、会话名使用 `Text maxLines={1}`，其父级 Flex 容器必须显式具备可收缩宽度约束（`minWidth={0}` / `width="100%"`），避免靠零散 CSS 类名补丁修复截断。

---

## 四、界面布局与窗口框架约束

1. **窗口最小尺寸与三区域结构**：
   - 最小窗口尺寸：`900 × 620`（在 [index.ts](file:///Users/fansicheng/Projects/Pi/src/main/index.ts) 约束）。
   - 三区域构成：
     - **最左 Icon Rail**：固定宽度 `48px`（`3rem`），承载全局一级导航（主页、自定义、更新提醒）。
     - **可折叠会话侧栏（SideNav）**：默认 `248px`，可拖拽范围 `196px ~ 400px`（`Cmd+B` 或顶栏按钮切换）。
     - **主工作区面板（Surface Panel）**：承载 `TopBar` + 主内容区（`HomeScreen`、`ChatLayout` 或 `CustomizeScreen`）。
2. **各视图列宽预算**：
   - **对话视图（消息流 + 输入区）**：统一共享同一个阅读列宽常量（`760px`），`ChatMessageList` 与 `Composer` 严格左右对齐。
   - **主页（HomeScreen）**：中心引导列采用 `640px`（符合 Astryx 表单/阅读列标准）。
   - **自定义资源页（CustomizeScreen / Detail）**：采用 `960px` 混合内容列宽。
3. **TopBar 与 macOS 红绿灯对齐**：
   - `TopBar` 高度固定 `56px`（`3.5rem`），左侧为 macOS 红绿灯预留安全区，不遮挡侧栏折叠按钮。
   - 标题栏始终保持单行不折行，操作按钮与拖拽区域互不干扰（`window-no-drag`）。
4. **窄窗口（`900px`）响应要求**：
   - 当侧栏展开至最大 `400px` 时，主工作区约 `452px` 宽。输入区模型按钮支持文本截断（`maxLines={1}`），指标行（`ComposerMetrics`）支持自动换行（`wrap="wrap"`），页面不得产生水平滚动条或元素溢出版心。
