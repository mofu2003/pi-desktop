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
                    Task { _ = await sessionStore.newSession() }
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
    }
}
