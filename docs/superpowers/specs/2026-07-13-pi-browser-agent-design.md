# Pi Browser Agent — Design Spec

**Date:** 2026-07-13  
**Status:** Draft, pending review  
**Author:** Kimi Code (with user)  

## 1. 一句话总结

Pi Browser Agent 是一个 Chromium 浏览器扩展，通过 Native Messaging 桥接本地 Pi agent，让用户用自然语言指令在浏览器里执行 computer-use 操作（滚动、点击、填表、截图等），所有动作在 side panel 中可视化，并在完成后给出极简汇报。

## 2. 目标与非目标

### 2.1 目标（Goals）

- **本地优先**：Pi agent、Native Host、LLM 调用全部跑在用户本地机器上。
- **一键唤醒**：安装脚本 + 扩展图标点击即可启动 agent，无需手动配置 Native Messaging manifest。
- **自然语言驱动**：用户在 side panel 输入自然语言，Pi 把意图转成 `browser_*` 工具调用。
- **行为可视化**：每个工具调用（名称、参数、耗时、截图）实时展示在 side panel。
- **完工汇报**：任务结束后只展示 `tools`、`time` 和 agent 自己的一句话总结。
- **无人工边界**：官方 Pi computer-use 支持什么工具，我们就暴露什么工具，不额外加限制。
- **继承 Pi 登录态**：默认读取 `~/.pi/agent/auth.json`，也允许用户在设置里手动填写 provider/model/API key。

### 2.2 非目标（Non-Goals）

- 不做通用的 AI Gateway（不是 litellm 类产品）。
- 不托管后端服务，不代理用户流量到远程服务器。
- 不在第一版支持非 Chromium 内核浏览器（如 Safari、Firefox）。
- 不做复杂的权限审批流；敏感操作通过设置里的 toggle 统一开关，单次确认弹窗在后续版本考虑。

## 3. 用户体验流程

### 3.1 安装流程

1. 用户访问 onboarding 页面或 GitHub release。
2. 运行一键脚本：下载扩展 `.zip`/CRX、注册 Native Host、写入浏览器 manifest。
3. 打开 Chrome，固定扩展图标。
4. （可选）在 Pi CLI 里完成 `/login`；或在扩展设置里手动输入 API key。

### 3.2 日常使用流程

1. 用户在任意网页点击扩展图标，side panel 从右侧滑出。
2. 用户输入指令：例如 *"Scroll to the bottom and click Load more"*。
3. 扩展通过 Native Messaging 把指令发给本地 Pi agent。
4. Pi agent 调用 computer-use tools（`browser_scroll`、`browser_screenshot`、`browser_click` 等）。
5. 扩展在网页上执行 DOM/鼠标操作，并回传截图/结果给 Pi。
6. side panel 实时显示每个 tool 的调用卡片。
7. 任务完成后，side panel 出现红色左边框的 completion card，展示 tools 数量、耗时、总结。

## 4. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Chromium Browser                         │
│  ┌──────────────┐  ┌─────────────────────────────────────┐  │
│  │  Toolbar     │  │  Side Panel (extension page)        │  │
│  │  Icon        │  │  - chat messages                    │  │
│  └──────┬───────┘  │  - tool cards                       │  │
│         │          │  - settings / completion report     │  │
│         │          └─────────────────────────────────────┘  │
│         │                          │                        │
│  ┌──────▼───────┐                 │                        │
│  │  Content     │  inject overlays/highlight/target        │  │
│  │  Script      │  extract DOM, execute clicks, scroll     │  │
│  └──────┬───────┘                 │                        │
└─────────┼─────────────────────────┼────────────────────────┘
          │                         │
          │    chrome.runtime.sendNativeMessage
          │                         │
┌─────────▼─────────────────────────▼────────────────────────┐
│                    Native Messaging Host                    │
│  - stdio bridge between browser and Pi CLI                  │
│  - forwards JSON-RPC / tool-call messages                   │
└─────────────────────────┬──────────────────────────────────┘
                          │
                          │  stdin/stdout
                          │
┌─────────────────────────▼──────────────────────────────────┐
│                      Pi Agent (local)                       │
│  - reads ~/.pi/agent/auth.json                              │
│  - loads computer-use skill                                 │
│  - calls LLM with screenshot + tool results                 │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 关键模块

| 模块 | 职责 | 技术 |
|---|---|---|
| `manifest.json` | 声明 permissions、side_panel、nativeMessaging、content_scripts | Chrome Extension MV3 |
| `sidepanel.html` + `sidepanel.js` | 聊天 UI、工具卡片渲染、输入发送、状态显示 | 纯 HTML/CSS/JS |
| `content.js` | 在页面注入高亮、执行点击/滚动/截图、提取可交互元素 | Content Script |
| `background.js` | 管理 Native Messaging 端口生命周期、图标点击事件 | Service Worker |
| `native-host` | 本地可执行文件，连接浏览器与 Pi CLI | Python / Node / Rust，选性能最好、依赖最少的 |
| `settings.html` | 扩展独立设置页 | 纯 HTML/CSS/JS |
| `onboarding.html` | 安装引导页 | 纯 HTML/CSS/JS |

## 5. 设计系统：Red Line System

已用设计 mockup 验证，全部页面统一使用以下 token。

### 5.1 色彩

| Token | 值 | 用途 |
|---|---|---|
| `bg` | `#FFFFFF` | 主背景、卡片背景 |
| `surface` | `#F8F9FA` | 输入框、工具卡片、设置卡片、hover 背景 |
| `border` | `#DADCE0` | 边框、分隔线、滚动条 |
| `text` | `#202124` | 主文字 |
| `text-secondary` | `#5F6368` | 次要文字、hint |
| `text-muted` | `#9AA0A6` | 时间戳、状态说明 |
| `accent` | `#EB0028` | 红色点缀：状态点、左侧竖线、发送按钮、选中态 |
| `accent-hover` | `#C40020` | 按钮 hover |

### 5.2 形状与布局

- 圆角统一 `8px`（按钮、卡片、输入框、图标）。
- Agent 相关卡片/消息左侧加 `3px` 红色竖线。
- Chrome side panel 固定宽度 `380px`。
- 字体：系统字体栈 `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`；等宽字体用于参数、时间、hint。

### 5.3 红色使用规则

红色只出现在三个地方，避免视觉噪音：
1. 状态点（如模型在线指示）。
2. agent 卡片/完成报告左侧竖线。
3. 发送按钮、选中/激活态。

## 6. 页面与组件

### 6.1 Side Panel（`sidepanel.html`）

- **Header**：π 图标 + "Pi Browser Agent" + 状态点/模型名 + 设置按钮 + 新会话按钮。
- **Chat area**：
  - 用户消息：右对齐，浅灰背景。
  - Agent 消息：左对齐，工具卡片嵌套在 bubble 内。
  - Tool card：左侧红竖线，header 显示 `tool_name` 和 `done 120ms`，body 显示参数键值对，可选截图。
  - Thinking 状态：三个红色脉冲点 + "Agent is waiting for page load..."
- **Input area**：底部固定输入框，红色发送按钮，hint 提示 Enter 发送 / Shift+Enter 换行。

### 6.2 Settings（`settings.html` / `context-settings.html`）

- **Authentication**：二选一
  - Use Pi login（默认，继承 `~/.pi/agent/auth.json`）
  - Configure here（手动输入 provider/model/API key）
- **Model**：Provider 下拉、Model ID、API Key。
- **Browser Behavior**：
  - Auto-screenshot after tools
  - Highlight targeted elements
  - Confirm sensitive actions
  - Full-page screenshots
- **Advanced**：Native Host Path、Pi CLI Path。
- 底部 `Reset` / `Save changes`。

### 6.3 Completion Report（`context-completed.html` / `browser-page-completed.html`）

任务完成后只展示三项，保持极简：
1. Agent 一句话总结。
2. `tools: N`
3. `time: Nms`

视觉：白色卡片、红色左侧竖线、无标题、无装饰图标。

### 6.4 Browser Overlay（Working）

- 目标元素外框：`2px solid #EB0028`，呼吸动画。
- 操作 tooltip：深色小标签显示当前 tool 名称与 selector。
- 右下角 toast：π 图标 + "Pi is acting on this page" + 当前 tool。

### 6.5 Onboarding（`onboarding.html`）

四步安装引导：
1. Install Pi CLI
2. Install Native Host（一键脚本）
3. Configure LLM
4. Pin extension

每步用卡片展示，完成态左侧红竖线 + 红色对勾。

## 7. 工具集（Computer Use）

本扩展暴露 Pi 官方 computer-use 支持的全部浏览器工具，不人为删减。第一版至少包括：

- `browser_screenshot` — 截图（viewport / fullPage）。
- `browser_scroll` — 滚动到指定方向或元素。
- `browser_click` — 点击指定元素。
- `browser_type` — 在输入框填入文本。
- `browser_navigate` — 导航到 URL（敏感操作，可被确认开关拦截）。
- `browser_get_text` — 提取页面或元素文本。
- `browser_find_element` — 定位可交互元素并返回 selector。

工具 schema 与返回格式直接复用 Pi 官方定义，不做二次包装。

## 8. 安全与隐私

- **本地运行**：LLM API key 只存在 `~/.pi/agent/auth.json` 或浏览器 local storage，不离开本机。
- **Native Host 校验**：manifest 中指定固定 origin 和 allowed extension id；Native Host 只接受来自该扩展的连接。
- **敏感操作确认**：默认关闭，用户可在设置开启。开启后，`browser_navigate` 及匹配到支付/删除/外部链接的 `browser_click` 先弹窗确认。
- **内容脚本权限**：只在用户主动打开 side panel 时注入/激活，避免后台持续读取页面。
- **Content Security Policy**：扩展页面禁用内联脚本，CSS 不使用外部 CDN（mockup 中用了 Google Fonts 的页面在实现时需移除或内联）。

## 9. 里程碑

### Phase 1 — MVP（验证核心链路）

- [ ] 扩展骨架：manifest、side panel、content script、background service worker。
- [ ] Native Host：最小可运行桥接程序，支持 Chrome Native Messaging 协议。
- [ ] Pi agent 调用：发送用户输入，接收 tool calls，回传结果。
- [ ] 实现 `browser_screenshot`、`browser_scroll`、`browser_click`。
- [ ] Side panel 渲染 tool cards 和 completion report。

### Phase 2 — 完整工具与体验

- [ ] 补齐 `browser_type`、`browser_navigate`、`browser_get_text`、`browser_find_element`。
- [ ] 浏览器 overlay（高亮、tooltip、toast）。
- [ ] Settings 页面与 local storage 持久化。
- [ ] 一键安装脚本。

### Phase 3 —  polish

- [ ] Onboarding 页面。
- [ ] 错误状态与重试机制。
- [ ] 键盘快捷键（如 Cmd/Ctrl+Shift+P 打开面板）。
- [ ] 打包发布：Chrome Web Store / GitHub release。

## 10. 待确认问题

1. Native Host 技术栈：Python（开发快）/ Node（与 Pi 同生态）/ Rust（性能最好、体积最小）？
2. 是否需要在第一版支持 Windows/Linux/macOS 全平台安装脚本？
3. `browser_navigate` 等敏感操作的确认弹窗，是用 Chrome `window.confirm` 还是自定义 overlay？
4. 是否复用 Pi 现有的消息协议，还是自定义 JSON-RPC？

## 11. 参考文件

- 设计 mockups：`/Users/mvgz0236/alttina/Tars/design-mockups/`
- 在线预览：`http://localhost:8766`
