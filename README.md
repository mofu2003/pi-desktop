# Pi Desktop

一个为 Pi Coding Agent 做的桌面客户端。底层模型、工具、扩展、技能、命令和会话格式由 Pi CLI 提供。

桌面界面默认使用简体中文。模型名、会话内容、工具输出和扩展提供的文案按原文显示。

macOS Apple Silicon 安装包在 [GitHub Releases](https://github.com/mofu2003/pi-desktop/releases/latest)。

## 需要

- Apple Silicon Mac，macOS 13 或更高版本
- 首次使用前，Pi 本身应已配置好模型和凭据

DMG 内置 Pi 1.6.0 独立运行时。启动后，桌面端通过 Pi 官方 JSONL RPC 协议自动连接。有上次项目时直接连接该项目。首次打开时先建立临时连接，选择项目后再启动可保存会话的项目进程。

桌面端与终端版共用 `~/.pi/agent` 中的配置、认证和会话，支持进程环境中的 `PI_CODING_AGENT_DIR`。已有模型配置可以直接使用。首次配置也可以在终端打开安装包内置的 Pi：

```bash
/Applications/Pi.app/Contents/Resources/pi-runtime/pi
```

## 开发

```bash
npm install
npm run dev
npm test
```

开发模式使用本机 Pi CLI。需要指定其他 Pi 可执行文件时，可以用 `PI_BINARY` 启动应用。

## 构建

```bash
npm run build
npm run package
```

产物在 `release/`，使用本地 ad-hoc 签名。打包时会获取官方 Pi arm64 发行包并校验固定的 SHA-256。已有上游归档时，可通过 `PI_BUNDLE_ARCHIVE` 指定本地文件，校验规则相同。

实现依据见 [Pi 桌面运行时调研](docs/pi-runtime-research.md)。

## 自定义

点击侧栏的「自定义」浏览个人和项目的技能、MCP 配置及扩展。可以搜索资源、预览技能文件，并在访达中定位来源。安装和修改资源通过 Pi CLI 或配置文件完成。

## 更新

安装版启动时检查 GitHub 上的稳定版本。从 0.5.11 起，可通过侧栏更新提示或 macOS 菜单中的「Pi → 检查更新」下载新版。Pi 校验安装包后会提供「重启并安装」。发布资产缺少 SHA-256 摘要时可以手动下载 DMG。

发布新版时，更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，运行测试并构建，再将 `Pi-X.Y.Z-arm64.dmg` 上传到对应的 `vX.Y.Z` GitHub Release。安装包上传完成后，将该 Release 发布为正式版本。

## 结构

- `src/main/pi-host.ts`：Pi 子进程、RPC 收发、会话读取
- `src/main/index.ts`：窗口、菜单、文件选择、IPC
- `src/main/updates.ts`：GitHub Release 更新检查和安装交互
- `src/main/mac-update.ts`：macOS 安装包下载、校验和替换
- `src/preload/`：受限的 Electron bridge
- `src/renderer/src/`：React + Astryx 界面
- `src/shared/types.ts`：主进程、preload、界面共用的 Pi 协议类型

## 已知边界

- 只实现 Pi 原生能力的桌面呈现，不增加审批流、MCP 管理、计划模式或子代理
- 发布包仅做本地 ad-hoc 签名，不能作为已通过 Gatekeeper 的公开分发版本
