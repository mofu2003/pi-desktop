import Foundation

enum CustomizationService {
    static func listResources(projectCwd: String?) -> [CustomizationResource] {
        var resources: [CustomizationResource] = []
        let userRoot = SessionStore.agentRoot()
        resources.append(contentsOf: scanScope(root: userRoot, scope: "user"))

        if let projectCwd, !projectCwd.isEmpty {
            let projectPiRoot = URL(fileURLWithPath: projectCwd).appendingPathComponent(".pi", isDirectory: true)
            resources.append(contentsOf: scanScope(root: projectPiRoot, scope: "project"))
        }
        return resources
    }

    static func readPreview(at location: String) -> String {
        let url = URL(fileURLWithPath: location)
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else {
            return ""
        }
        if isDir.boolValue {
            let skillMd = url.appendingPathComponent("SKILL.md")
            if let text = try? String(contentsOf: skillMd, encoding: .utf8) {
                return text
            }
            let files = (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
            return files.sorted().joined(separator: "\n")
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    private static func scanScope(root: URL, scope: String) -> [CustomizationResource] {
        var list: [CustomizationResource] = []
        let skillsDir = root.appendingPathComponent("skills", isDirectory: true)
        if let items = try? FileManager.default.contentsOfDirectory(
            at: skillsDir,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                let skillFile = item.appendingPathComponent("SKILL.md")
                let desc = parseFrontmatterDescription(at: skillFile)
                list.append(CustomizationResource(
                    id: "\(scope):skills:\(item.path)",
                    kind: "skills",
                    scope: scope,
                    name: item.lastPathComponent,
                    description: desc,
                    location: item.path
                ))
            }
        }

        let extDir = root.appendingPathComponent("extensions", isDirectory: true)
        if let items = try? FileManager.default.contentsOfDirectory(
            at: extDir,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                list.append(CustomizationResource(
                    id: "\(scope):extensions:\(item.path)",
                    kind: "extensions",
                    scope: scope,
                    name: item.lastPathComponent,
                    description: "Pi 扩展目录",
                    location: item.path
                ))
            }
        }

        return list
    }

    private static func parseFrontmatterDescription(at fileURL: URL) -> String? {
        guard let content = try? String(contentsOf: fileURL, encoding: .utf8),
              content.hasPrefix("---") else {
            return nil
        }
        let lines = content.components(separatedBy: .newlines).dropFirst()
        for line in lines {
            if line.trimmingCharacters(in: .whitespaces) == "---" { break }
            if line.lowercased().hasPrefix("description:") {
                let raw = String(line.dropFirst("description:".count))
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                return raw.isEmpty ? nil : raw
            }
        }
        return nil
    }
}
