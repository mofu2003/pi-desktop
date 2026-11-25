import AppKit
import SwiftUI

struct SidebarView: View {
    @Bindable var sessionStore: PiSessionStore
    @Bindable var libraryStore: LibraryStore
    @Bindable var updateService: UpdateService
    @Binding var isCustomizing: Bool

    let onNewSession: (ProjectInfo?) -> Void
    let onOpenSession: (SessionSummary, ProjectInfo) -> Void
    let onRenameSession: (SessionSummary, ProjectInfo) -> Void
    let onDeleteSession: (SessionSummary, ProjectInfo, Bool) -> Void

    @State private var isArchiveExpanded = false
    @Environment(\.openSettings) private var openSettings
    @State private var expandedProjects: Set<String> = []
    @State private var groupDialog: (title: String, initial: String, onSave: (String) -> Void)?
    @State private var groupInput = ""

    private enum Layout {
        static let edgePadding: CGFloat = 14
        static let iconWidth: CGFloat = 18
        static let iconTextGap: CGFloat = 8
        static let childIndent: CGFloat = edgePadding + iconWidth + iconTextGap
    }

    private var archivedPaths: Set<String> {
        Set(libraryStore.archivedSessions.map(\.session.path))
    }

    private var groupedSessionPaths: Set<String> {
        Set(libraryStore.groups.flatMap(\.sessionPaths))
    }

    private func sessionsByPath(excluding archived: Set<String>) -> [String: (SessionSummary, ProjectInfo)] {
        var map: [String: (SessionSummary, ProjectInfo)] = [:]
        var sources = libraryStore.projects
        if let unassigned = sessionStore.unassignedWorkspace {
            sources.append(unassigned)
        }
        for project in sources {
            let list = libraryStore.sessionsByProject[project.path] ?? []
            for session in list where !archived.contains(session.path) {
                map[session.path] = (session, project)
            }
        }
        return map
    }

    private func recentSessions(
        excluding excluded: Set<String>, sortedBy sort: (SessionSummary, SessionSummary) -> Bool
    ) -> [(SessionSummary, ProjectInfo)] {
        guard let unassigned = sessionStore.unassignedWorkspace else { return [] }
        let list = libraryStore.sessionsByProject[unassigned.path] ?? []
        return list
            .filter { !excluded.contains($0.path) }
            .sorted(by: sort)
            .map { ($0, unassigned) }
    }

    var body: some View {
        let archived = archivedPaths
        let excluded = archived.union(groupedSessionPaths)
        let pinned = Set(libraryStore.pinnedSessions)
        let grouped = libraryStore.groups.isEmpty ? [:] : sessionsByPath(excluding: archived)
        let recent = recentSessions(excluding: excluded) { sortByPin($0, $1, pinned: pinned) }

        VStack(spacing: 0) {
            VStack(spacing: 2) {
                SidebarTopActionButton(
                    title: "新建会话",
                    systemImage: "square.and.pencil",
                    isActive: false,
                    isDisabled: sessionStore.isConnecting,
                    action: { onNewSession(nil) }
                )

                SidebarTopActionButton(
                    title: "自定义",
                    systemImage: "briefcase",
                    isActive: isCustomizing,
                    isDisabled: false,
                    action: { isCustomizing.toggle() }
                )
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 10)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(libraryStore.groups.enumerated()), id: \.element.id) { index, group in
                        sectionHeader(group.name)
                            .contextMenu {
                                Button("重命名分区…") {
                                    groupInput = group.name
                                    groupDialog = ("重命名分区", group.name, { name in
                                        libraryStore.renameGroup(id: group.id, name: name)
                                    })
                                }
                                Button("上移分区") {
                                    guard index > 0 else { return }
                                    libraryStore.groups.swapAt(index, index - 1)
                                }
                                .disabled(index == 0)
                                Button("移除分区") {
                                    libraryStore.removeGroup(id: group.id)
                                }
                            }

                        let groupSessions = group.sessionPaths
                            .compactMap { grouped[$0] }
                            .sorted { sortByPin($0.0, $1.0, pinned: pinned) }
                        if groupSessions.isEmpty {
                            emptyPlaceholder("暂无会话", leading: Layout.edgePadding)
                        } else {
                            ForEach(groupSessions, id: \.0.path) { session, sourceProject in
                                sessionRow(session, project: sourceProject, archived: false, textLeading: Layout.edgePadding)
                            }
                        }
                    }

                    if !libraryStore.projects.isEmpty {
                        sectionHeader("项目")
                            .padding(.top, libraryStore.groups.isEmpty ? 0 : 10)

                        ForEach(sortedProjects) { project in
                            let isExpanded = expandedProjects.contains(project.path)
                            SidebarDisclosureHeader(
                                title: project.name,
                                systemImage: "folder",
                                isExpanded: isExpanded
                            ) {
                                withAnimation(.easeInOut(duration: 0.16)) {
                                    if isExpanded {
                                        expandedProjects.remove(project.path)
                                    } else {
                                        expandedProjects.insert(project.path)
                                    }
                                }
                            }
                            .contextMenu {
                                Button("在此项目中新建会话") { onNewSession(project) }
                                Button(libraryStore.pinnedProjects.contains(project.path) ? "取消置顶" : "置顶项目") {
                                    libraryStore.togglePinProject(project.path)
                                }
                                Button("在 Finder 中显示") {
                                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)])
                                }
                                Divider()
                                Button("从侧栏移除", role: .destructive) {
                                    libraryStore.removeProject(path: project.path)
                                }
                            }

                            if isExpanded {
                                let sessions = (libraryStore.sessionsByProject[project.path] ?? [])
                                    .filter { !excluded.contains($0.path) }
                                    .sorted { sortByPin($0, $1, pinned: pinned) }
                                if sessions.isEmpty {
                                    emptyPlaceholder("暂无会话", leading: Layout.childIndent)
                                } else {
                                    ForEach(sessions) { session in
                                        sessionRow(session, project: project, archived: false, textLeading: Layout.childIndent)
                                    }
                                }
                            }
                        }
                    }

                    sectionHeader("最近")
                        .padding(.top, 12)

                    if recent.isEmpty {
                        emptyPlaceholder("暂无会话", leading: Layout.edgePadding)
                    } else {
                        ForEach(recent, id: \.0.path) { session, sourceProject in
                            sessionRow(session, project: sourceProject, archived: false, textLeading: Layout.edgePadding)
                        }
                    }

                    SidebarDisclosureHeader(
                        title: "归档",
                        systemImage: "archivebox",
                        isExpanded: isArchiveExpanded
                    ) {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            isArchiveExpanded.toggle()
                        }
                    }
                    .padding(.top, 12)

                    if isArchiveExpanded {
                        if libraryStore.archivedSessions.isEmpty {
                            emptyPlaceholder("暂无归档会话", leading: Layout.childIndent)
                        } else {
                            ForEach(libraryStore.archivedSessions) { entry in
                                sessionRow(entry.session, project: entry.sourceProject, archived: true, textLeading: Layout.childIndent)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }

            if let update = updateService.availableUpdate {
                Divider()
                Button {
                    updateService.alertMessage = (
                        "发现新版本 Pi \(update.version)",
                        "是否立即在软件内下载并安装更新？",
                        true
                    )
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.down.circle.fill")
                            .foregroundStyle(Color.accentColor)
                        Text(updateService.isInstalling ? "正在下载更新…" : "更新到 v\(update.version)")
                            .font(.body.weight(.medium))
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(updateService.isInstalling)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
            }

            SidebarTopActionButton(
                title: "设置",
                systemImage: "gearshape",
                isActive: false,
                isDisabled: false,
                action: { openSettings() }
            )
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .alert(groupDialog?.title ?? "", isPresented: Binding(
            get: { groupDialog != nil },
            set: { if !$0 { groupDialog = nil } }
        )) {
            TextField("名称", text: $groupInput)
            Button("取消", role: .cancel) { groupDialog = nil }
            Button("保存") {
                let trimmed = groupInput.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                groupDialog?.onSave(trimmed)
                groupDialog = nil
            }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.callout.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.leading, Layout.edgePadding)
            .padding(.trailing, 8)
            .padding(.top, 4)
            .padding(.bottom, 4)
    }

    private func emptyPlaceholder(_ title: String, leading: CGFloat) -> some View {
        Text(title)
            .font(.callout)
            .foregroundStyle(.tertiary)
            .padding(.leading, leading)
            .padding(.vertical, 4)
    }

    private var sortedProjects: [ProjectInfo] {
        libraryStore.projects.sorted { lhs, rhs in
            let lPinned = libraryStore.pinnedProjects.contains(lhs.path)
            let rPinned = libraryStore.pinnedProjects.contains(rhs.path)
            if lPinned != rPinned { return lPinned }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
    }

    @ViewBuilder
    private func sessionRow(
        _ session: SessionSummary,
        project: ProjectInfo,
        archived: Bool,
        textLeading: CGFloat
    ) -> some View {
        let title = libraryStore.sessionNames[session.path] ?? session.name ?? session.title
        let isSelected = session.path == sessionStore.activeSessionPath
        let isUnread = libraryStore.unreadSessions.contains(session.path)
        let isPinned = libraryStore.pinnedSessions.contains(session.path)

        SidebarSessionRowButton(
            title: title,
            isSelected: isSelected,
            isUnread: isUnread,
            isPinned: isPinned,
            leadingPadding: textLeading,
            action: { onOpenSession(session, project) }
        )
        .contextMenu {
            if archived {
                Button("恢复会话") { libraryStore.restoreSession(path: session.path) }
                Button("永久删除…", role: .destructive) { onDeleteSession(session, project, true) }
            } else {
                Button("重命名…") { onRenameSession(session, project) }
                Button(isPinned ? "取消置顶" : "置顶") { libraryStore.togglePinSession(session.path) }
                Button(isUnread ? "标记为已读" : "标记为未读") {
                    libraryStore.setSessionUnread(session.path, unread: !isUnread)
                }
                Menu("移入分区") {
                    ForEach(libraryStore.groups) { group in
                        Button(group.name) { libraryStore.moveSession(session.path, toGroup: group.id) }
                    }
                    if groupedSessionPaths.contains(session.path) {
                        Button("移出分区") { libraryStore.moveSession(session.path, toGroup: nil) }
                    }
                    Divider()
                    Button("新建分区…") {
                        groupInput = ""
                        groupDialog = ("新建分区", "", { name in
                            libraryStore.createGroup(name: name, initialPath: session.path)
                        })
                    }
                }
                Divider()
                Button("复制为 Markdown") {
                    let md = SessionStore.readMarkdown(at: session.path)
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(md, forType: .string)
                }
                Button("在 Finder 中显示") {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: session.path)])
                }
                Divider()
                Button("归档") { libraryStore.archiveSession(session, sourceProject: project) }
                Button("移到废纸篓…", role: .destructive) { onDeleteSession(session, project, false) }
            }
        }
    }

    private func sortByPin(_ lhs: SessionSummary, _ rhs: SessionSummary, pinned: Set<String>) -> Bool {
        let lPinned = pinned.contains(lhs.path)
        let rPinned = pinned.contains(rhs.path)
        if lPinned != rPinned { return lPinned }
        return lhs.modified > rhs.modified
    }

}

private struct SidebarTopActionButton: View {
    let title: String
    let systemImage: String
    let isActive: Bool
    let isDisabled: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.body)
                    .foregroundStyle(isActive ? Color.accentColor : Color.secondary)
                    .frame(width: 18, alignment: .center)
                Text(title)
                    .font(.body.weight(isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? Color.primary : Color.primary.opacity(0.92))
                Spacer()
            }
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(isActive ? Color.accentColor.opacity(0.14) : (isHovered ? Color.primary.opacity(0.06) : Color.clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .onHover { isHovered = $0 }
    }
}

private struct SidebarDisclosureHeader: View {
    let title: String
    let systemImage: String
    let isExpanded: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 18, alignment: .center)
                Text(title)
                    .font(.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(isHovered ? Color.primary.opacity(0.06) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

private struct SidebarSessionRowButton: View {
    let title: String
    let isSelected: Bool
    let isUnread: Bool
    let isPinned: Bool
    let leadingPadding: CGFloat
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if isPinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if isUnread {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.leading, leadingPadding)
            .padding(.trailing, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(
                        isSelected
                            ? Color.primary.opacity(0.1)
                            : (isHovered ? Color.primary.opacity(0.05) : Color.clear)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}
