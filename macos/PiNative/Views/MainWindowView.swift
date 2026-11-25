import AppKit
import SwiftUI

struct MainWindowView: View {
    @Bindable var sessionStore: PiSessionStore
    @Bindable var libraryStore: LibraryStore
    @Binding var columnVisibility: NavigationSplitViewVisibility

    @State private var draft = ""
    @State private var attachments: [ImageAttachment] = []
    @State private var isCustomizing = false
    @State private var isCreatingProject = false
    @State private var renameTarget: (session: SessionSummary, project: ProjectInfo, name: String)?
    @State private var deleteTarget: (session: SessionSummary, project: ProjectInfo, permanent: Bool)?
    @State private var forkMessages: [ForkableMessage]?
    @State private var isForking = false

    private var activeProject: ProjectInfo? {
        guard let current = sessionStore.project else { return nil }
        if current.isUnassigned == true { return nil }
        if current.ssh != nil { return current }
        return libraryStore.projects.first(where: { $0.path == current.path }) ?? current
    }

    private var hasConversation: Bool {
        !sessionStore.messages.isEmpty || sessionStore.optimisticUser != nil || sessionStore.runningBash != nil
    }

    private var canChooseProject: Bool {
        !hasConversation && !sessionStore.isStreaming
    }

    private var currentTitle: String {
        if isCustomizing { return "自定义" }
        if let name = sessionStore.state?.sessionName, !name.isEmpty { return name }
        if let activePath = sessionStore.activeSessionPath,
           let alias = libraryStore.sessionNames[activePath], !alias.isEmpty {
            return alias
        }
        if let firstUser = sessionStore.messages.first(where: { $0.role == "user" }),
           let firstLine = firstUser.content?.plainText.components(separatedBy: .newlines).first?.trimmingCharacters(in: .whitespaces),
           !firstLine.isEmpty {
            return firstLine
        }
        return "新会话"
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(
                sessionStore: sessionStore,
                libraryStore: libraryStore,
                isCustomizing: $isCustomizing,
                onNewSession: { target in
                    Task {
                        if await sessionStore.newSession(targetProject: target) {
                            draft = ""
                            attachments = []
                            isCustomizing = false
                        }
                    }
                },
                onOpenSession: { session, sourceProject in
                    Task {
                        if await sessionStore.openSession(path: session.path, sourceProject: sourceProject) {
                            draft = ""
                            attachments = []
                            libraryStore.setSessionUnread(session.path, unread: false)
                            isCustomizing = false
                        }
                    }
                },
                onRenameSession: { session, sourceProject in
                    let initial = libraryStore.sessionNames[session.path] ?? session.name ?? session.title
                    renameTarget = (session, sourceProject, initial)
                },
                onDeleteSession: { session, sourceProject, permanent in
                    deleteTarget = (session, sourceProject, permanent)
                }
            )
            .navigationSplitViewColumnWidth(min: 220, ideal: 256, max: 360)
        } detail: {
            detailContent
                .background(Color(nsColor: .textBackgroundColor))
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        HStack(spacing: 6) {
                            if let activeProject {
                                HStack(spacing: 4) {
                                    Image(systemName: activeProject.ssh != nil ? "terminal" : "folder")
                                        .foregroundStyle(.secondary)
                                        .font(.caption)
                                    Text(activeProject.ssh?.displayLabel ?? activeProject.name)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Text("/")
                                        .foregroundStyle(.tertiary)
                                        .font(.caption)
                                }
                            }
                            Text(currentTitle)
                                .font(.headline)
                                .lineLimit(1)
                        }
                    }
                    ToolbarItemGroup(placement: .primaryAction) {
                        if !isCustomizing, sessionStore.state != nil, !sessionStore.messages.isEmpty {
                            Menu {
                                Button("从历史消息分叉…") {
                                    Task { forkMessages = await sessionStore.getForkMessages() }
                                }
                                Button("克隆当前分支") {
                                    Task { _ = await sessionStore.cloneSession() }
                                }
                                Divider()
                                Button("复制最后一条回复") {
                                    Task { await sessionStore.copyLastAssistantText() }
                                }
                                Button("导出为 HTML…") {
                                    Task { await sessionStore.exportSessionHtml() }
                                }
                            } label: {
                                Label("会话操作", systemImage: "ellipsis.circle")
                            }
                        }
                    }
                }
        }
        .sheet(isPresented: $isCreatingProject) {
            CreateProjectSheet(
                existingProjects: libraryStore.projects,
                onCreate: { created in
                    libraryStore.addProject(created)
                    isCreatingProject = false
                    if canChooseProject {
                        Task { _ = await sessionStore.newSession(targetProject: created) }
                    }
                }
            )
        }
        .sheet(item: Binding(
            get: { forkMessages.map { ForkSheetPayload(messages: $0) } },
            set: { if $0 == nil { forkMessages = nil } }
        )) { payload in
            ForkSessionSheet(
                messages: payload.messages,
                isForking: isForking,
                onSelect: { entryId in
                    isForking = true
                    Task {
                        if await sessionStore.forkSession(entryId: entryId) {
                            forkMessages = nil
                            isCustomizing = false
                        }
                        isForking = false
                    }
                },
                onCancel: { forkMessages = nil }
            )
        }
        .sheet(item: $sessionStore.extensionRequest) { req in
            ExtensionRequestSheet(request: req) { value, confirmed, cancelled in
                Task {
                    await sessionStore.respondToExtension(
                        id: req.id,
                        value: value,
                        confirmed: confirmed,
                        cancelled: cancelled
                    )
                }
            }
        }
        .alert("重命名会话", isPresented: Binding(
            get: { renameTarget != nil },
            set: { if !$0 { renameTarget = nil } }
        )) {
            TextField("会话名称", text: Binding(
                get: { renameTarget?.name ?? "" },
                set: { renameTarget?.name = $0 }
            ))
            Button("取消", role: .cancel) { renameTarget = nil }
            Button("保存") {
                guard let target = renameTarget else { return }
                let trimmed = target.name.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                Task {
                    if target.session.path == sessionStore.activeSessionPath {
                        _ = await sessionStore.renameActiveSession(to: trimmed)
                    } else {
                        try? SessionStore.renameSessionFile(at: target.session.path, name: trimmed)
                    }
                    libraryStore.renameSession(path: target.session.path, name: trimmed)
                    libraryStore.refreshAllSessions(unassignedWorkspace: sessionStore.unassignedWorkspace)
                    renameTarget = nil
                }
            }
        }
        .alert(
            deleteTarget?.permanent == true ? "永久删除会话？" : "移到废纸篓？",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            )
        ) {
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button(deleteTarget?.permanent == true ? "永久删除" : "移到废纸篓", role: .destructive) {
                guard let target = deleteTarget else { return }
                deleteTarget = nil
                if target.permanent {
                    try? SessionStore.deleteSession(at: target.session.path)
                } else {
                    try? SessionStore.trashSession(at: target.session.path)
                }
                libraryStore.removeSession(path: target.session.path, projectPath: target.project.path)
                if target.session.path == sessionStore.activeSessionPath {
                    Task { _ = await sessionStore.newSession() }
                }
            }
        } message: {
            Text(deleteTarget?.permanent == true ? "删除后将无法恢复此会话记录。" : "会话文件将被移入系统废纸篓。")
        }
    }

    @ViewBuilder
    private var detailContent: some View {
        VStack(spacing: 0) {
            if let error = sessionStore.errorMessage {
                BannerBar(
                    text: error,
                    isError: true,
                    onDismiss: { sessionStore.errorMessage = nil }
                )
            } else if let note = sessionStore.notificationMessage {
                BannerBar(
                    text: note.text,
                    isError: note.status == "error",
                    onDismiss: { sessionStore.notificationMessage = nil }
                )
            }

            if isCustomizing {
                CustomizeView(
                    project: activeProject?.ssh == nil ? activeProject : nil,
                    onBack: { isCustomizing = false }
                )
            } else if hasConversation {
                VStack(spacing: 0) {
                    MessageListView(
                        messages: sessionStore.messages,
                        toolExecutions: sessionStore.toolExecutions,
                        runningBash: sessionStore.runningBash,
                        optimisticUser: sessionStore.optimisticUser,
                        isStreaming: sessionStore.isStreaming
                    )
                    if sessionStore.state != nil {
                        composerBlock
                            .padding(.horizontal, 20)
                            .padding(.bottom, 14)
                    }
                }
            } else {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    VStack(spacing: 24) {
                        ChatEmptyStateView(
                            projectName: activeProject?.ssh?.displayLabel ?? activeProject?.name,
                            isConnecting: sessionStore.isConnecting,
                            isRuntimeConnected: sessionStore.isRuntimeConnected,
                            onReconnect: { Task { await sessionStore.reconnect() } }
                        )
                        composerBlock
                    }
                    .padding(.horizontal, 24)
                    Spacer(minLength: 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var composerBlock: some View {
        ComposerView(
            sessionStore: sessionStore,
            libraryStore: libraryStore,
            activeProject: activeProject,
            canChooseProject: canChooseProject,
            draft: $draft,
            attachments: $attachments,
            onCreateProject: { isCreatingProject = true },
            onSubmit: { text, images in
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed == "/fork" && images.isEmpty {
                    draft = ""
                    Task { forkMessages = await sessionStore.getForkMessages() }
                    return
                }
                let oldDraft = draft
                let oldImages = attachments
                draft = ""
                attachments = []
                Task {
                    let accepted = await sessionStore.send(text: oldDraft, images: oldImages)
                    if !accepted {
                        draft = oldDraft
                        attachments = oldImages
                    } else {
                        libraryStore.refreshAllSessions(unassignedWorkspace: sessionStore.unassignedWorkspace)
                    }
                }
            }
        )
    }
}

private struct BannerBar: View {
    let text: String
    let isError: Bool
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(isError ? Color.red : Color.accentColor)
            Text(text)
                .font(.callout)
                .textSelection(.enabled)
                .lineLimit(3)
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(isError ? Color.red.opacity(0.08) : Color.accentColor.opacity(0.08))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

private struct ChatEmptyStateView: View {
    let projectName: String?
    let isConnecting: Bool
    let isRuntimeConnected: Bool
    let onReconnect: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            PiMarkView(size: 46, showCardFrame: true)

            VStack(spacing: 6) {
                Text(projectName.map { "想用 Pi 在 \($0) 里做什么？" } ?? "想用 Pi 做什么？")
                    .font(.system(size: 22, weight: .semibold))
                Text("输入 / 浏览命令 · ! 运行 Shell · ⌘N 新建会话")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if !isRuntimeConnected {
                HStack(spacing: 8) {
                    Circle()
                        .fill(isConnecting ? Color.accentColor : Color.red)
                        .frame(width: 8, height: 8)
                    Text(isConnecting ? "正在连接 Pi…" : "Pi 未连接")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if !isConnecting {
                        Button("重新连接", action: onReconnect)
                            .buttonStyle(.link)
                    }
                }
                .padding(.top, 2)
            }
        }
        .multilineTextAlignment(.center)
    }
}
