import Foundation
import Observation

struct SidebarGroup: Codable, Equatable, Identifiable, Sendable {
    let id: String
    var name: String
    var sessionPaths: [String]
    var projectPaths: [String]
}

struct ArchivedSessionEntry: Codable, Equatable, Identifiable, Sendable {
    var id: String { session.path }
    let session: SessionSummary
    let sourceProject: ProjectInfo
}

private struct LibrarySnapshot: Codable {
    var projects: [ProjectInfo] = []
    var groups: [SidebarGroup] = []
    var sessionNames: [String: String] = [:]
    var pinnedSessions: [String] = []
    var pinnedProjects: [String] = []
    var unreadSessions: [String] = []
    var archivedSessions: [ArchivedSessionEntry] = []
    var customSshHosts: [SshHostInfo] = []
    var sshRemoteCwds: [String: [String]] = [:]
}

@Observable
@MainActor
final class LibraryStore {
    var projects: [ProjectInfo] = []
    var groups: [SidebarGroup] = []
    var sessionNames: [String: String] = [:]
    var pinnedSessions: [String] = []
    var pinnedProjects: [String] = []
    var unreadSessions: [String] = []
    var archivedSessions: [ArchivedSessionEntry] = []
    var customSshHosts: [SshHostInfo] = []
    var sshRemoteCwds: [String: [String]] = [:]
    var sessionsByProject: [String: [SessionSummary]] = [:]

    private let storageURL: URL

    init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("PiNative", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.storageURL = dir.appendingPathComponent("library.json")
        load()
    }

    func refreshAllSessions(unassignedWorkspace: ProjectInfo?) {
        var allProjects = projects
        if let unassignedWorkspace {
            allProjects.append(unassignedWorkspace)
        }
        var updated: [String: [SessionSummary]] = [:]
        for project in allProjects where project.ssh == nil {
            updated[project.path] = SessionStore.listSessions(for: project.path)
        }
        sessionsByProject = updated
    }

    func addProject(_ project: ProjectInfo) {
        guard project.isUnassigned != true, project.ssh == nil else { return }
        if !projects.contains(where: { $0.path == project.path }) {
            projects.append(project)
            save()
        }
    }

    func removeProject(path: String) {
        projects.removeAll { $0.path == path }
        pinnedProjects.removeAll { $0 == path }
        for index in groups.indices {
            groups[index].projectPaths.removeAll { $0 == path }
        }
        sessionsByProject.removeValue(forKey: path)
        save()
    }

    func renameSession(path: String, name: String) {
        sessionNames[path] = name
        save()
    }

    func removeSession(path: String, projectPath: String) {
        sessionsByProject[projectPath]?.removeAll { $0.path == path }
        pinnedSessions.removeAll { $0 == path }
        unreadSessions.removeAll { $0 == path }
        for index in groups.indices {
            groups[index].sessionPaths.removeAll { $0 == path }
        }
        save()
    }

    func togglePinSession(_ path: String) {
        if let idx = pinnedSessions.firstIndex(of: path) {
            pinnedSessions.remove(at: idx)
        } else {
            pinnedSessions.insert(path, at: 0)
        }
        save()
    }

    func togglePinProject(_ path: String) {
        if let idx = pinnedProjects.firstIndex(of: path) {
            pinnedProjects.remove(at: idx)
        } else {
            pinnedProjects.insert(path, at: 0)
        }
        save()
    }

    func setSessionUnread(_ path: String, unread: Bool) {
        if unread {
            if !unreadSessions.contains(path) { unreadSessions.append(path) }
        } else {
            unreadSessions.removeAll { $0 == path }
        }
        save()
    }

    func archiveSession(_ session: SessionSummary, sourceProject: ProjectInfo) {
        if !archivedSessions.contains(where: { $0.session.path == session.path }) {
            archivedSessions.insert(ArchivedSessionEntry(session: session, sourceProject: sourceProject), at: 0)
        }
        unreadSessions.removeAll { $0 == session.path }
        save()
    }

    func restoreSession(path: String) {
        archivedSessions.removeAll { $0.session.path == path }
        save()
    }

    func createGroup(name: String, initialPath: String? = nil, isProject: Bool = false) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let group = SidebarGroup(
            id: UUID().uuidString,
            name: trimmed,
            sessionPaths: (!isProject && initialPath != nil) ? [initialPath!] : [],
            projectPaths: (isProject && initialPath != nil) ? [initialPath!] : []
        )
        groups.append(group)
        save()
    }

    func renameGroup(id: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let idx = groups.firstIndex(where: { $0.id == id }) else { return }
        groups[idx].name = trimmed
        save()
    }

    func removeGroup(id: String) {
        groups.removeAll { $0.id == id }
        save()
    }

    func moveSession(_ path: String, toGroup groupId: String?) {
        for idx in groups.indices {
            groups[idx].sessionPaths.removeAll { $0 == path }
        }
        if let groupId, let idx = groups.firstIndex(where: { $0.id == groupId }) {
            groups[idx].sessionPaths.append(path)
        }
        save()
    }

    func moveProject(_ path: String, toGroup groupId: String?) {
        for idx in groups.indices {
            groups[idx].projectPaths.removeAll { $0 == path }
        }
        if let groupId, let idx = groups.firstIndex(where: { $0.id == groupId }) {
            groups[idx].projectPaths.append(path)
        }
        save()
    }

    func recordCustomSshHost(_ host: SshHostInfo) {
        customSshHosts.removeAll { $0.name == host.name }
        customSshHosts.insert(host, at: 0)
        if customSshHosts.count > 20 { customSshHosts = Array(customSshHosts.prefix(20)) }
        save()
    }

    func recordRemoteCwd(host: String, cwd: String) {
        let normalized = cwd.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        var list = sshRemoteCwds[host] ?? []
        list.removeAll { $0 == normalized }
        list.insert(normalized, at: 0)
        if list.count > 8 { list = Array(list.prefix(8)) }
        sshRemoteCwds[host] = list
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: storageURL),
              let snap = try? JSONDecoder().decode(LibrarySnapshot.self, from: data) else {
            return
        }
        projects = snap.projects
        groups = snap.groups
        sessionNames = snap.sessionNames
        pinnedSessions = snap.pinnedSessions
        pinnedProjects = snap.pinnedProjects
        unreadSessions = snap.unreadSessions
        archivedSessions = snap.archivedSessions
        customSshHosts = snap.customSshHosts
        sshRemoteCwds = snap.sshRemoteCwds
    }

    private func save() {
        let snap = LibrarySnapshot(
            projects: projects,
            groups: groups,
            sessionNames: sessionNames,
            pinnedSessions: pinnedSessions,
            pinnedProjects: pinnedProjects,
            unreadSessions: unreadSessions,
            archivedSessions: archivedSessions,
            customSshHosts: customSshHosts,
            sshRemoteCwds: sshRemoteCwds
        )
        if let data = try? JSONEncoder().encode(snap) {
            try? data.write(to: storageURL, options: .atomic)
        }
    }
}
