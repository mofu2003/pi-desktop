import AppKit
import Foundation

enum SessionStore {
    static func agentRoot() -> URL {
        if let env = ProcessInfo.processInfo.environment["PI_CODING_AGENT_DIR"], !env.isEmpty {
            return URL(fileURLWithPath: env).standardizedFileURL
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent", isDirectory: true)
    }

    static func sessionsRoot() -> URL {
        agentRoot().appendingPathComponent("sessions", isDirectory: true)
    }

    static func unassignedWorkspaceURL() throws -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("PiNative/workspace", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func unassignedProject() throws -> ProjectInfo {
        let url = try unassignedWorkspaceURL()
        return ProjectInfo(path: url.path, name: "无项目", isUnassigned: true)
    }

    static func projectSessionsDirectory(for cwd: String) -> URL {
        let resolved = URL(fileURLWithPath: cwd).resolvingSymlinksInPath().path
        let stripped = resolved.trimmingPrefix("/")
        let safe = "--" + stripped
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .replacingOccurrences(of: ":", with: "-") + "--"
        return sessionsRoot().appendingPathComponent(safe, isDirectory: true)
    }

    static func listSessions(for cwd: String, includeAll: Bool = false) -> [SessionSummary] {
        let dir = projectSessionsDirectory(for: cwd)
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .creationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        let summaries = entries
            .filter { $0.pathExtension == "jsonl" }
            .compactMap { Task.isCancelled ? nil : parseSessionSummary(at: $0) }
            .filter { includeAll || $0.messageCount > 0 }
            .sorted { $0.modified > $1.modified }

        return summaries
    }

    static func parseSessionSummary(at url: URL) -> SessionSummary? {
        guard let content = try? Data(contentsOf: url) else { return nil }
        let lines = content.split(separator: 0x0A)
        guard let headerLine = lines.first,
              let header = try? JSONDecoder().decode([String: JSONValue].self, from: headerLine),
              header["type"]?.stringValue == "session",
              let sessionId = header["id"]?.stringValue else {
            return nil
        }

        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let mtime = (attrs?[.modificationDate] as? Date) ?? Date()
        let ctime = (attrs?[.creationDate] as? Date) ?? mtime

        var sessionName: String?
        var firstUserMessage = ""
        var messageCount = 0

        let decoder = JSONDecoder()
        for line in lines.dropFirst() {
            guard !Task.isCancelled else { return nil }
            guard let entry = try? decoder.decode(SessionSummaryEntry.self, from: line) else {
                continue
            }
            if entry.type == "session_info" {
                let raw = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines)
                sessionName = raw?.isEmpty == false ? raw : nil
            } else if let message = entry.message, entry.type == "message" {
                messageCount += 1
                if firstUserMessage.isEmpty, let text = message.userText {
                    firstUserMessage = text.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }

        let fallback = "未命名会话"
        let preview = firstUserMessage.isEmpty ? fallback : firstUserMessage
        let title = sessionName ?? (firstUserMessage.isEmpty ? fallback : firstUserMessage)
        let createdDate = header["timestamp"]?.stringValue.flatMap(parseISO8601) ?? ctime

        return SessionSummary(
            sessionId: sessionId,
            path: url.path,
            cwd: header["cwd"]?.stringValue ?? "",
            name: sessionName,
            title: title,
            preview: preview,
            messageCount: messageCount,
            created: createdDate,
            modified: mtime
        )
    }

    private struct SessionSummaryEntry: Decodable {
        let type: String
        let name: String?
        let message: Message?

        private enum CodingKeys: String, CodingKey { case type, name, message }

        init(from decoder: Decoder) throws {
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            type = try fields.decode(String.self, forKey: .type)
            name = type == "session_info" ? try? fields.decode(String.self, forKey: .name) : nil
            message = type == "message" ? try? fields.decode(Message.self, forKey: .message) : nil
        }

        struct Message: Decodable {
            let userText: String?

            private enum CodingKeys: String, CodingKey { case role, content }

            init(from decoder: Decoder) throws {
                let fields = try decoder.container(keyedBy: CodingKeys.self)
                guard (try? fields.decode(String.self, forKey: .role)) == "user" else {
                    userText = nil
                    return
                }
                if let text = try? fields.decode(String.self, forKey: .content) {
                    userText = text
                } else if let blocks = try? fields.decode([TextBlock].self, forKey: .content) {
                    userText = blocks.compactMap(\.text).joined(separator: "\n")
                } else {
                    userText = nil
                }
            }
        }

        private struct TextBlock: Decodable {
            let text: String?

            private enum CodingKeys: String, CodingKey { case type, text }

            init(from decoder: Decoder) throws {
                guard let fields = try? decoder.container(keyedBy: CodingKeys.self),
                      (try? fields.decode(String.self, forKey: .type)) == "text" else {
                    text = nil
                    return
                }
                text = try? fields.decode(String.self, forKey: .text)
            }
        }
    }

    static func renameSessionFile(at sessionPath: String, name: String) throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let url = URL(fileURLWithPath: sessionPath)
        let content = try String(contentsOf: url, encoding: .utf8)
        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }
        var parentId: String?
        for line in lines.reversed() {
            if let data = line.data(using: .utf8),
               let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data),
               let id = obj["id"]?.stringValue,
               obj["type"]?.stringValue != "session" {
                parentId = id
                break
            }
        }
        let entry: [String: JSONValue] = [
            "type": .string("session_info"),
            "id": .string(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8).lowercased()),
            "parentId": parentId.map(JSONValue.string) ?? .null,
            "timestamp": .string(ISO8601DateFormatter().string(from: Date())),
            "name": .string(trimmed)
        ]
        let encoded = try JSONEncoder().encode(entry)
        guard var lineString = String(data: encoded, encoding: .utf8) else { return }
        lineString += "\n"
        let handle = try FileHandle(forUpdating: url)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(lineString.utf8))
        try handle.close()
    }

    static func trashSession(at sessionPath: String) throws {
        var trashedURL: NSURL?
        try FileManager.default.trashItem(at: URL(fileURLWithPath: sessionPath), resultingItemURL: &trashedURL)
    }

    static func deleteSession(at sessionPath: String) throws {
        try FileManager.default.removeItem(atPath: sessionPath)
    }

    static func readMarkdown(at sessionPath: String) -> String {
        guard let content = try? String(contentsOfFile: sessionPath, encoding: .utf8) else { return "" }
        let lines = content.components(separatedBy: .newlines).filter { !$0.isEmpty }
        var sections: [String] = []
        for line in lines {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data),
                  obj["type"]?.stringValue == "message",
                  let msg = obj["message"]?.objectValue,
                  let role = msg["role"]?.stringValue else {
                continue
            }
            if role == "user", let contentVal = msg["content"] {
                let text = extractPlainText(contentVal)
                if !text.isEmpty { sections.append("## 用户\n\n\(text)") }
            } else if role == "assistant", let contentVal = msg["content"] {
                let text = extractPlainText(contentVal)
                if !text.isEmpty { sections.append("## Pi\n\n\(text)") }
            }
        }
        return sections.joined(separator: "\n\n---\n\n")
    }

    static func findSessionById(_ sessionId: String) -> SessionSummary? {
        let root = sessionsRoot()
        guard let dirs = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return nil }
        for dir in dirs {
            guard let files = try? FileManager.default.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ) else { continue }
            for file in files where file.pathExtension == "jsonl" {
                if let summary = parseSessionSummary(at: file), summary.sessionId == sessionId {
                    return summary
                }
            }
        }
        return nil
    }

    static func createProject(name: String, sourceFolder: URL?) throws -> ProjectInfo {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw NSError(domain: "PiNative", code: 1, userInfo: [NSLocalizedDescriptionKey: "请输入项目名称。"])
        }
        if let sourceFolder {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: sourceFolder.path, isDirectory: &isDir), isDir.boolValue else {
                throw NSError(domain: "PiNative", code: 2, userInfo: [NSLocalizedDescriptionKey: "源文件夹不存在，请重新选择。"])
            }
            return ProjectInfo(path: sourceFolder.resolvingSymlinksInPath().path, name: trimmed)
        }
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("PiNative/projects/\(UUID().uuidString.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return ProjectInfo(path: dir.path, name: trimmed)
    }

    private static func extractPlainText(_ value: JSONValue) -> String {
        switch value {
        case .string(let s):
            return s
        case .array(let items):
            return items.compactMap { item -> String? in
                guard case .object(let dict) = item, dict["type"]?.stringValue == "text" else { return nil }
                return dict["text"]?.stringValue
            }.joined(separator: "\n")
        default:
            return ""
        }
    }

    private static func parseISO8601(_ str: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: str) ?? ISO8601DateFormatter().date(from: str)
    }
}
