# Changelog

## Unreleased

- 移除左侧工作目录路径和底部状态显示，改为常驻主页图标栏与单一主页。
- 桌面端应用图标改用 Pi 官网标志，采用白底和品牌配色。

## 0.1.2 - 2026-11-24

- 安装版启动时检查 GitHub Releases，macOS「Pi」菜单提供「检查更新」。
- 检测到适用的稳定版本时，可从提示下载 DMG，退出 Pi 后手动替换应用。
- 版本比较、兼容安装包筛选和下载地址测试通过。macOS arm64 打包、Astryx 检查、DMG 完整性和应用签名校验通过。
- 安装包采用 ad-hoc 签名，尚未做 Apple Developer ID 签名和公证。

## 0.1.1 - 2026-11-24

- 桌面界面默认使用简体中文，覆盖欢迎页、会话侧栏、输入区、工具状态、扩展对话框和错误提示。
- macOS 应用菜单及项目打开操作使用中文标签。会话时间使用中文格式。
- 模型名、会话内容、工具输出和扩展提供的文案按原文显示。
- macOS arm64 打包和 Astryx 检查通过。实测打包版的欢迎页、项目选择、会话页、思考菜单和 macOS 菜单。DMG 校验及镜像内应用签名校验通过。

## 0.1.0 - 2026-11-24

### Added

- Pi Desktop 的 Electron + React + Astryx 桌面界面
- 通过 `pi --mode rpc` 连接本机 Pi，支持流式消息、工具调用状态和扩展 UI
- 项目选择、最近会话、新建会话、切换会话
- 模型选择、thinking level、上下文占用和运行状态展示
- 原生 macOS 窗口、菜单、隐藏式标题栏和可折叠侧栏（按钮与 `Cmd+B`）
- 输入区与消息列对齐，并适配 900px 最小窗口
- macOS arm64 DMG 打包配置

### Verification

- `npm run build` 通过
- `npx astryx doctor --built out/renderer` 全部检查通过
- Pi RPC 只读命令（状态、消息、模型、统计、命令）实测通过
- Electron 开发模式与打包版均完成启动、项目打开、会话切换、模型菜单、thinking 菜单、新会话、侧栏折叠和窄窗口视觉验收
- 最终 DMG 通过 `hdiutil verify`，DMG 内应用通过 `codesign --verify --deep --strict`

### Known limitations

- 当前使用 ad-hoc 签名；尚未使用 Apple Developer ID 签名和公证，不能直接作为已通过 Gatekeeper 的公开分发版本
- 真实模型对话会消耗 Pi 所配置服务的额度，未在自动化验收中调用
