import AppKit
import SwiftUI

@main
struct PiNativeApp: App {
    @State private var sessionStore = PiSessionStore()
    @State private var libraryStore = LibraryStore()
    @State private var updateService = UpdateService()
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some Scene {
        WindowGroup("Pi") {
            MainWindowView(
                sessionStore: sessionStore,
                libraryStore: libraryStore,
                updateService: updateService,
                columnVisibility: $columnVisibility
            )
            .frame(minWidth: 900, minHeight: 620)
            .task {
                updateService.startWatcher()
                await sessionStore.bootstrap()
                libraryStore.refreshAllSessions(unassignedWorkspace: sessionStore.unassignedWorkspace)
            }
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(after: .appInfo) {
                Button("检查更新…") {
                    Task { await updateService.checkManually() }
                }
                .disabled(updateService.isChecking || updateService.isInstalling)
            }
            CommandGroup(replacing: .newItem) {
                Button("新建会话") {
                    Task { _ = await sessionStore.newSession(target: .unassigned) }
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(after: .sidebar) {
                Button(columnVisibility == .detailOnly ? "展开侧边栏" : "收起侧边栏") {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly
                    }
                }
                .keyboardShortcut("\\", modifiers: .command)
            }
        }

        Settings {
            PiSettingsView(sessionStore: sessionStore, updateService: updateService)
        }
    }
}

private struct PiSettingsView: View {
    let sessionStore: PiSessionStore
    let updateService: UpdateService

    @State private var provider = ""
    @State private var notice: (title: String, body: String, isUpdatePrompt: Bool)?

    private var providerID: String {
        provider.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasValidProvider: Bool {
        providerID.range(of: #"^[a-zA-Z0-9][a-zA-Z0-9._-]*$"#, options: .regularExpression) != nil
    }

    var body: some View {
        TabView {
            Tab("模型", systemImage: "cpu") { modelsPage }
            Tab("通用", systemImage: "gearshape") {
                Form {
                    LabeledContent("版本", value: "Pi \(updateService.currentVersion)")
                    Button("检查更新…") {
                        Task { await updateService.checkManually { notice = $0 } }
                    }
                    .disabled(updateService.isChecking || updateService.isInstalling)
                }
                .formStyle(.grouped)
            }
        }
        .frame(width: 500, height: 340)
        .alert(notice?.title ?? "", isPresented: Binding(
            get: { notice != nil },
            set: { if !$0 { notice = nil } }
        )) {
            if notice?.isUpdatePrompt == true {
                Button("取消", role: .cancel) {}
                Button("立即更新") {
                    Task { await updateService.installAvailableUpdate() }
                }
            } else {
                Button("好", role: .cancel) {}
            }
        } message: {
            Text(notice?.body ?? "")
        }
    }

    private var modelsPage: some View {
        Form {
            Section {
                TextField("提供商 ID", text: $provider, prompt: Text("例如 openai、anthropic、deepseek"))
                HStack {
                    Button("登录订阅…") { launchAuthentication(useAPIKey: false) }
                    Button("配置 API Key…") { launchAuthentication(useAPIKey: true) }
                }
                .disabled(!hasValidProvider)
            } header: {
                Text("提供商认证")
            } footer: {
                Text("Pi 会在终端引导登录或输入密钥，并将凭据保存在本机的 Pi 配置中。")
            }

            Section("兼容 API") {
                Button("编辑 models.json…", action: openModelsConfiguration)
                Button("重新连接本机 Pi") {
                    Task { await sessionStore.reconnect() }
                }
                .disabled(sessionStore.project?.ssh != nil || sessionStore.isConnecting
                          || sessionStore.isStreaming || sessionStore.isBashRunning)
            }
        }
        .formStyle(.grouped)
    }

    private func launchAuthentication(useAPIKey: Bool) {
        let provider = providerID
        guard hasValidProvider else { return }
        Task {
            do {
                try await PiProcessHost.openAuthentication(provider: provider, useAPIKey: useAPIKey)
            } catch {
                notice = ("无法启动 Pi 登录", error.localizedDescription, false)
            }
        }
    }

    private func openModelsConfiguration() {
        do {
            let root = SessionStore.agentRoot()
            let file = root.appendingPathComponent("models.json")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: file.path) {
                try Data("{\"providers\": {}}\n".utf8).write(to: file, options: .withoutOverwriting)
            }
            guard NSWorkspace.shared.open(file) else {
                NSWorkspace.shared.activateFileViewerSelecting([file])
                return
            }
        } catch {
            notice = ("无法打开模型配置", error.localizedDescription, false)
        }
    }
}
