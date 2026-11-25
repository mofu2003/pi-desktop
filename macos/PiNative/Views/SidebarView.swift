import AppKit
import SwiftUI

struct SidebarView: View {
    @Bindable var sessionStore: PiSessionStore
    @Bindable var libraryStore: LibraryStore
    @Binding var isCustomizing: Bool

    let onNewSession: (ProjectInfo?) -> Void
    let onOpenSession: (SessionSummary, ProjectInfo) -> Void
    let onRenameSession: (SessionSummary, ProjectInfo) -> Void
    let onDeleteSession: (SessionSummary, ProjectInfo, Bool) -> Void

    @State private var isArchiveExpanded = false
    @State private var groupDialog: (title: String, initial: String, onSave: (String) -> Void)?
    @State private var groupInput = ""

    private var archivedPaths: Set<String> {
        Set(libraryStore.archivedSessions.map(\.session.path))
    }

    private var groupedSessionPaths: Set<String> {
        Set(libraryStore.groups.flatMap(\.sessionPaths))
    }

    private var allSessionsByPath: [String: (SessionSummary, ProjectInfo)] {
        var map: [String: (SessionSummary, ProjectInfo)] = [:]
        var sources = libraryStore.projects
        if let unassigned = sessionStore.unassignedWorkspace {
            sources.append(unassigned)
        }
        for project in sources {
            let list = libraryStore.sessionsByProject[project.path] ?? []
            for session in list where !archivedPaths.contains(session.path) {
                map[session.path] = (session, project)
            }
        }
        return map
    }

    private var recentSessions: [(SessionSummary, ProjectInfo)] {
        guard let unassigned = sessionStore.unassignedWorkspace else { return [] }
        let list = libraryStore.sessionsByProject[unassigned.path] ?? []
        return list
            .filter { !archivedPaths.contains($0.path) && !groupedSessionPaths.contains($0.path) }
            .sorted(by: sortByPinAndDate)
            .map { ($0, unassigned) }
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 4) {
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
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 6)

            List {
                ForEach(Array(libraryStore.groups.enumerated()), id: \.element.id) { index, group in
                    Section {
                        let groupSessions = group.sessionPaths
                            .compactMap { allSessionsByPath[$0] }
                            .sorted { sortByPin($0.0, $1.0) }
                        if groupSessions.isEmpty {
                            Text("暂无会话")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        } else {
                            ForEach(groupSessions, id: \.0.path) { session, sourceProject in
                                sessionRow(session, project: sourceProject, archived: false)
                            }
                        }
                    } header: {
                        HStack {
                            Text(group.name)
                            Spacer()
                        }
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
                    }
                }

                if !libraryStore.projects.isEmpty {
                    Section("项目") {
                        ForEach(sortedProjects) { project in
                            DisclosureGroup {
                                let sessions = (libraryStore.sessionsByProject[project.path] ?? [])
                                    .filter { !archivedPaths.contains($0.path) && !groupedSessionPaths.contains($0.path) }
                                    .sorted(by: sortByPinAndDate)
                                if sessions.isEmpty {
                                    Text("暂无会话")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                } else {
                                    ForEach(sessions) { session in
                                        sessionRow(session, project: project, archived: false)
                                    }
                                }
                            } label: {
                                Label(project.name, systemImage: "folder")
                                    .lineLimit(1)
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
                        }
                    }
                }

                Section("最近") {
                    if recentSessions.isEmpty {
                        Text("暂无会话")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    } else {
                        ForEach(recentSessions, id: \.0.path) { session, sourceProject in
                            sessionRow(session, project: sourceProject, archived: false)
                        }
                    }
                }

                Section {
                    DisclosureGroup(isExpanded: $isArchiveExpanded) {
                        if libraryStore.archivedSessions.isEmpty {
                            Text("暂无归档会话")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        } else {
                            ForEach(libraryStore.archivedSessions) { entry in
                                sessionRow(entry.session, project: entry.sourceProject, archived: true)
                            }
                        }
                    } label: {
                        Label("归档", systemImage: "archivebox")
                    }
                }
            }
            .listStyle(.sidebar)
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

    private var sortedProjects: [ProjectInfo] {
        libraryStore.projects.sorted { lhs, rhs in
            let lPinned = libraryStore.pinnedProjects.contains(lhs.path)
            let rPinned = libraryStore.pinnedProjects.contains(rhs.path)
            if lPinned != rPinned { return lPinned }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
    }

    @ViewBuilder
    private func sessionRow(_ session: SessionSummary, project: ProjectInfo, archived: Bool) -> some View {
        let title = libraryStore.sessionNames[session.path] ?? session.name ?? session.title
        let isSelected = session.path == sessionStore.activeSessionPath
        let isUnread = libraryStore.unreadSessions.contains(session.path)
        let isPinned = libraryStore.pinnedSessions.contains(session.path)

        Button {
            onOpenSession(session, project)
        } label: {
            HStack(spacing: 6) {
                if isPinned {
                    Image(systemName: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if isUnread {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 7, height: 7)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
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

    private func sortByPin(_ lhs: SessionSummary, _ rhs: SessionSummary) -> Bool {
        let lPinned = libraryStore.pinnedSessions.contains(lhs.path)
        let rPinned = libraryStore.pinnedSessions.contains(rhs.path)
        if lPinned != rPinned { return lPinned }
        return lhs.modified > rhs.modified
    }

    private func sortByPinAndDate(_ lhs: SessionSummary, _ rhs: SessionSummary) -> Bool {
        sortByPin(lhs, rhs)
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
                    .font(.callout)
                    .foregroundStyle(isActive ? Color.accentColor : Color.secondary)
                    .frame(width: 18)
                Text(title)
                    .font(.callout.weight(isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? Color.primary : Color.primary.opacity(0.9))
                Spacer()
            }
            .padding(.horizontal, 10)
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
