# Pi Desktop

一个为 Pi Coding Agent 做的原生桌面客户端。界面参考 Codex 的交互结构，产品完成度参考 Claude Desktop；底层模型、工具、扩展、技能、命令和会话格式全部由本机 Pi CLI 提供。

桌面界面默认使用简体中文。模型名、会话内容、工具输出和扩展提供的文案按原文显示。

macOS Apple Silicon 安装包在 [GitHub Releases](https://github.com/mofu2003/pi-desktop/releases/latest)。

## 需要

- macOS 13 或更高版本
- 已安装并可运行的 Pi CLI（`pi --version`）
- 首次使用前，Pi 本身应已配置好模型和凭据

桌面端不会保存 API Key，也不会复制 Pi 的配置。它启动 `pi --mode rpc` 子进程，并通过 Pi 官方的 JSONL RPC 协议通信。

## 开发

```bash
npm install
npm run dev
npm test
```

## 构建

```bash
npm run build
npm run package
```

产物在 `release/`，使用本地 ad-hoc 签名。

## 自定义

点击侧栏的「自定义」浏览个人和项目的技能、MCP 配置及扩展。可以搜索资源、预览技能文件，并在访达中定位来源。安装和修改资源通过 Pi CLI 或配置文件完成。

## 更新

安装版启动时检查 GitHub 上的稳定版本，也可以选择 macOS 菜单中的「Pi → 检查更新」。发现有适用的新版时，选择「下载更新」，然后退出 Pi 并从 DMG 手动替换应用。当前发布包尚未做 Apple Developer ID 签名和公证。

发布新版时，更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，运行测试并构建，再将 `Pi-X.Y.Z-arm64.dmg` 上传到对应的 `vX.Y.Z` GitHub Release。安装包上传完成后，将该 Release 发布为正式版本。

## 结构

- `src/main/pi-host.ts`：Pi 子进程、RPC 收发、会话读取
- `src/main/index.ts`：窗口、菜单、文件选择、IPC
- `src/main/updates.ts`：GitHub Release 更新检查和下载提示
- `src/preload/`：受限的 Electron bridge
- `src/renderer/src/`：React + Astryx 界面
- `src/shared/types.ts`：主进程、preload、界面共用的 Pi 协议类型

## 已知边界

- 依赖本机 Pi CLI；桌面端不内置 Pi 运行时
- 只实现 Pi 原生能力的桌面呈现，不增加审批流、MCP 管理、计划模式或子代理
- 发布包仅做本地 ad-hoc 签名，不能作为已通过 Gatekeeper 的公开分发版本
