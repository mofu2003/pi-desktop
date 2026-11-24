# Changelog

## Unreleased

## 0.3.0 - 2026-11-24

- 自定义资源可打开详情。技能支持概览、文件选择与 Markdown/源码预览，MCP 显示配置状态和工具暴露规则。
- 「自定义」打开独立工作区，可按类别搜索本机技能、MCP 配置及扩展，并在访达中查看来源。新建分组改用侧栏的独立按钮。
- 修复从 Finder 启动时 Pi CLI 找不到 Node.js 的问题。会话启动失败时保留当前页面并显示错误。
- 修复顶栏渐变盖住工作区边框造成的接缝。
- 提供 macOS Apple Silicon DMG，采用 ad-hoc 签名，尚未经过 Apple 公证。
- 验证通过：5 项自动化测试、Electron 资源详情与新建会话测试、Astryx 检查、arm64 打包、DMG 完整性及包内签名校验。

## 0.2.0 - 2026-11-24

- 侧栏默认展开，支持拖动分界线调整宽度并保存。顶栏开关位于 macOS 红绿灯右侧，支持菜单和 `⌘B`。
- 新增多项目导航、自定义会话分组以及独立折叠的「项目」和「最近」。会话可通过菜单移入或移出分组，空项目也能折叠。
- 分组标题与普通会话采用不同字重和字号，箭头在悬停或键盘聚焦时显示。项目会话与目录名对齐，组间距增加。
- 左侧使用 macOS 原生磨砂，工作区为独立圆角面板，顶栏通过透明渐变衔接内容。主页布局和 Pi 应用图标已更新。
- 启动时恢复上次项目和会话列表，在需要会话时再启动 Pi CLI。后台检查新版，并在侧栏提示可下载的更新。
- 提供 macOS Apple Silicon DMG。应用使用 ad-hoc 签名，尚未完成 Apple Developer ID 签名和公证。
- 验证通过：5 项自动化测试、TypeScript 和 Electron 构建、Astryx 检查、arm64 打包、DMG 校验及包内应用签名校验。

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
