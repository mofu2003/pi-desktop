import AppKit
import SwiftUI

enum ConversationLayout {
    static let columnWidth: CGFloat = 740
    static let horizontalInset: CGFloat = 28
    static let coordinateSpace = "conversation"
}

extension View {
    func conversationColumn(alignment: Alignment = .center) -> some View {
        frame(maxWidth: ConversationLayout.columnWidth, alignment: alignment)
            .padding(.horizontal, ConversationLayout.horizontalInset)
            .frame(maxWidth: .infinity)
    }
}

struct MainWindowView: View {
    @Bindable var sessionStore: PiSessionStore
    @Bindable var libraryStore: LibraryStore
    @Bindable var updateService: UpdateService
    @Binding var columnVisibility: NavigationSplitViewVisibility

    @State private var draft = ""
    @State private var attachments: [ImageAttachment] = []
    @State private var isCustomizing = false
    @State private var isCreatingProject = false
    @State private var renameTarget: (session: SessionSummary, project: ProjectInfo, name: String)?
    @State private var deleteTarget: (session: SessionSummary, project: ProjectInfo, permanent: Bool)?
    @State private var forkMessages: [ForkableMessage]?
    @State private var isForking = false
    @State private var messageColumn: CGRect = .zero
    @State private var codeInspector = CodeInspectorStore()

    private var activeProject: ProjectInfo? {
        guard let current = sessionStore.project else { return nil }
        if current.isUnassigned == true { return nil }
        if current.ssh != nil { return current }
        return libraryStore.projects.first(where: { $0.path == current.path }) ?? current
    }

    private var hasConversation: Bool {
        !sessionStore.messages.isEmpty || !sessionStore.pendingUserMessages.isEmpty || sessionStore.runningBash != nil
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
                updateService: updateService,
                isCustomizing: $isCustomizing,
                onNewSession: { target in
                    Task {
                        let resolved: SessionProjectTarget = target.map { .project($0) } ?? .unassigned
                        if await sessionStore.newSession(target: resolved) {
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
            HSplitView {
                detailContent
                    .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                if codeInspector.isVisible {
                    CodeInspectorView(
                        store: codeInspector,
                        projectRootPath: activeProject?.ssh == nil ? activeProject?.path : nil
                    )
                    .frame(minWidth: 340, idealWidth: 520, maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .environment(\.openURL, OpenURLAction { url in
                if codeInspector.handleFileURL(url) {
                    return .handled
                }
                return .systemAction
            })
            .background(Color(nsColor: .textBackgroundColor))
            .toolbar {
                    ToolbarItem(placement: .navigation) {
                        HStack(spacing: 7) {
                            if !isCustomizing, let activeProject {
                                HStack(spacing: 5) {
                                    Image(systemName: activeProject.ssh != nil ? "terminal" : "folder")
                                        .foregroundStyle(.secondary)
                                        .font(.callout)
                                    Text(activeProject.ssh?.displayLabel ?? activeProject.name)
                                        .font(.body)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Text("/")
                                        .foregroundStyle(.tertiary)
                                        .font(.callout)
                                }
                            }
                            Text(currentTitle)
                                .font(.system(size: 15, weight: .semibold))
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        .frame(maxWidth: 320, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
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
                        Button {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                codeInspector.isVisible.toggle()
                            }
                        } label: {
                            Label(
                                codeInspector.isVisible ? "隐藏代码面板" : "显示代码面板",
                                systemImage: "sidebar.right"
                            )
                        }
                        .help(codeInspector.isVisible ? "隐藏代码面板" : "显示代码面板")
                    }
                }
        }
        .background {
            if !sessionStore.isRuntimeConnected {
                LeadingTitlebarAccessory(content: AnyView(connectionStatus))
                    .frame(width: 0, height: 0)
            }
        }
        .alert(
            updateService.alertMessage?.title ?? "",
            isPresented: Binding(
                get: { updateService.alertMessage != nil },
                set: { if !$0 { updateService.alertMessage = nil } }
            )
        ) {
            if updateService.alertMessage?.isUpdatePrompt == true {
                Button("取消", role: .cancel) { updateService.alertMessage = nil }
                Button("立即更新") {
                    updateService.alertMessage = nil
                    Task { await updateService.installAvailableUpdate() }
                }
            } else {
                Button("好", role: .cancel) { updateService.alertMessage = nil }
            }
        } message: {
            Text(updateService.alertMessage?.body ?? "")
        }
        .sheet(isPresented: $isCreatingProject) {
            CreateProjectSheet(
                existingProjects: libraryStore.projects,
                onCreate: { created in
                    libraryStore.addProject(created)
                    libraryStore.refreshSessions(for: created)
                    isCreatingProject = false
                    if canChooseProject {
                        Task { _ = await sessionStore.newSession(target: .project(created)) }
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
                        guard await sessionStore.renameActiveSession(to: trimmed) else { return }
                    } else {
                        let path = target.session.path
                        do {
                            try await Task.detached(priority: .userInitiated) {
                                try SessionStore.renameSessionFile(at: path, name: trimmed)
                            }.value
                        } catch {
                            sessionStore.errorMessage = error.localizedDescription
                            return
                        }
                    }
                    libraryStore.renameSession(path: target.session.path, name: trimmed)
                    libraryStore.refreshSessions(for: target.project)
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
                let path = target.session.path
                let permanent = target.permanent
                Task {
                    do {
                        try await Task.detached(priority: .userInitiated) {
                            if permanent {
                                try SessionStore.deleteSession(at: path)
                            } else {
                                try SessionStore.trashSession(at: path)
                            }
                        }.value
                        libraryStore.removeSession(path: path, projectPath: target.project.path)
                        libraryStore.refreshSessions(for: target.project)
                    } catch {
                        sessionStore.errorMessage = error.localizedDescription
                    }
                }
                if target.session.path == sessionStore.activeSessionPath {
                    Task { _ = await sessionStore.newSession(target: .unassigned) }
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
                ZStack(alignment: .bottom) {
                    MessageListView(
                        messages: sessionStore.messages,
                        toolExecutions: sessionStore.toolExecutions,
                        runningBash: sessionStore.runningBash,
                        pendingUserMessages: sessionStore.pendingUserMessages,
                        isStreaming: sessionStore.isStreaming,
                        onColumnChange: { messageColumn = $0 },
                        onOpenFile: { rawPath, startLine, endLine in
                            let resolvedPath: String
                            if rawPath.hasPrefix("/") {
                                resolvedPath = rawPath
                            } else if let root = activeProject?.path, activeProject?.ssh == nil {
                                resolvedPath = (root as NSString).appendingPathComponent(rawPath)
                            } else {
                                resolvedPath = rawPath
                            }
                            codeInspector.open(path: resolvedPath, startLine: startLine, endLine: endLine)
                        }
                    )
                    .equatable()
                    if sessionStore.state != nil {
                        conversationComposer
                            .padding(.top, 26)
                            .padding(.bottom, 14)
                            .background(
                                LinearGradient(
                                    colors: [
                                        Color(nsColor: .textBackgroundColor).opacity(0),
                                        Color(nsColor: .textBackgroundColor).opacity(0.88),
                                        Color(nsColor: .textBackgroundColor)
                                    ],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                                .allowsHitTesting(false)
                            )
                            .zIndex(10)
                    }
                }
                .coordinateSpace(name: ConversationLayout.coordinateSpace)
            } else {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    VStack(spacing: 24) {
                        ChatEmptyStateView(
                            projectName: activeProject?.ssh?.displayLabel ?? activeProject?.name
                        )
                        composerBlock
                            .conversationColumn()
                    }
                    Spacer(minLength: 40)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder
    private var connectionStatus: some View {
        if !sessionStore.isRuntimeConnected {
            if sessionStore.isConnecting {
                Label("正在连接 Pi…", systemImage: "circle.dotted")
                    .foregroundStyle(.secondary)
            } else {
                Button {
                    Task { await sessionStore.reconnect() }
                } label: {
                    Label("Pi 连接失败", systemImage: "exclamationmark.circle")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
                .help(sessionStore.errorMessage ?? "重新连接 Pi")
                .accessibilityHint("重新连接 Pi")
            }
        }
    }

    @ViewBuilder
    private var conversationComposer: some View {
        if messageColumn.width > 0 {
            composerStack
                .frame(width: messageColumn.width)
                .padding(.leading, messageColumn.minX)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            composerStack.conversationColumn()
        }
    }

    private var composerStack: some View {
        VStack(spacing: 8) {
            if !sessionStore.localQueuedMessages.isEmpty {
                QueuedMessagesCard(
                    items: sessionStore.localQueuedMessages,
                    onSendNow: { id in
                        Task { await sessionStore.sendQueuedMessageNow(id: id) }
                    },
                    onEdit: { id in
                        if let popped = sessionStore.popQueuedMessageForEditing(id: id) {
                            draft = popped.text
                            attachments = popped.images
                        }
                    },
                    onDelete: { id in
                        sessionStore.removeQueuedMessage(id: id)
                    }
                )
            }
            composerBlock
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
                let submittedProject = sessionStore.project
                draft = ""
                attachments = []
                Task {
                    let accepted = await sessionStore.send(text: oldDraft, images: oldImages)
                    if !accepted {
                        draft = oldDraft
                        attachments = oldImages
                    } else if let submittedProject {
                        libraryStore.refreshSessions(for: submittedProject)
                    }
                }
            }
        )
    }
}

private struct LeadingTitlebarAccessory: NSViewRepresentable {
    let content: AnyView

    func makeNSView(context: Context) -> Anchor {
        Anchor(content: content)
    }

    func updateNSView(_ view: Anchor, context: Context) {
        view.host.rootView = content
        view.resizeAccessory()
    }

    static func dismantleNSView(_ view: Anchor, coordinator: ()) {
        view.detachAccessory()
    }

    final class Anchor: NSView {
        let host: NSHostingView<AnyView>
        private let accessory = NSTitlebarAccessoryViewController()
        private weak var attachedWindow: NSWindow?

        init(content: AnyView) {
            host = NSHostingView(rootView: content)
            super.init(frame: .zero)
            accessory.layoutAttribute = .left
            accessory.view = host
        }

        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard window !== attachedWindow else { return }
            detachAccessory()
            guard let window else { return }
            resizeAccessory()
            window.addTitlebarAccessoryViewController(accessory)
            attachedWindow = window
        }

        func resizeAccessory() {
            let size = host.fittingSize
            if attachedWindow == nil {
                host.setFrameSize(size)
            } else if abs(host.frame.width - size.width) > 1 {
                // AppKit controls the height of a leading title-bar accessory.
                host.setFrameSize(NSSize(width: size.width, height: host.frame.height))
            }
        }

        func detachAccessory() {
            if let window = attachedWindow,
               let index = window.titlebarAccessoryViewControllers.firstIndex(of: accessory) {
                window.removeTitlebarAccessoryViewController(at: index)
            }
            attachedWindow = nil
        }
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
                .font(.body)
                .textSelection(.enabled)
                .lineLimit(3)
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(isError ? Color.red.opacity(0.08) : Color.accentColor.opacity(0.08))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
}

private struct ChatEmptyStateView: View {
    let projectName: String?

    var body: some View {
        VStack(spacing: 16) {
            PiMarkView(size: 48, showCardFrame: true)

            VStack(spacing: 8) {
                Text(projectName.map { "想用 Pi 在 \($0) 里做什么？" } ?? "想用 Pi 做什么？")
                    .font(.system(size: 25, weight: .semibold))
            }

        }
        .multilineTextAlignment(.center)
    }
}
