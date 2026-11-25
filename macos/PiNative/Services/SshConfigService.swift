import Foundation

enum SshInputError: LocalizedError {
    case empty
    case invalidCharacters
    case invalidPort
    case unsupportedOption(String)
    case invalidHost

    var errorDescription: String? {
        switch self {
        case .empty:
            return "请输入 SSH 主机名或 user@host 地址。"
        case .invalidCharacters:
            return "SSH 主机地址包含无效控制字符。"
        case .invalidPort:
            return "SSH 端口号无效。"
        case .unsupportedOption(let option):
            return "暂不支持的参数：\(option)，请直接输入主机别名或 user@host。"
        case .invalidHost:
            return "SSH 主机地址格式不正确，请输入如 my-server 或 user@host。"
        }
    }
}

struct ParsedSshTargetInput: Equatable, Sendable {
    let host: String
    let port: Int?
    let label: String
}

enum SshConfigService {
    private struct ParsedBlock {
        var patterns: [String]
        var hostName: String?
        var user: String?
        var port: Int?
    }

    static func defaultSshDirectory() -> URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh", isDirectory: true)
    }

    static func listHosts(in sshDir: URL = defaultSshDirectory()) -> [SshHostInfo] {
        let configURL = sshDir.appendingPathComponent("config")
        guard let content = try? String(contentsOf: configURL, encoding: .utf8) else {
            return []
        }
        return parseConfigContent(content, sshDir: sshDir)
    }

    static func parseConfigContent(
        _ content: String,
        sshDir: URL = defaultSshDirectory(),
        fileReader: ((URL) -> String?)? = nil
    ) -> [SshHostInfo] {
        let read: (URL) -> String? = fileReader ?? { url in
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else {
                return nil
            }
            return try? String(contentsOf: url, encoding: .utf8)
        }

        var visited = Set<String>()
        var collectedOrder: [String] = []
        var collectedMap: [String: SshHostInfo] = [:]

        func parseText(_ text: String) {
            var blocks: [ParsedBlock] = []
            var currentIndex: Int?

            for rawLine in text.components(separatedBy: .newlines) {
                guard let (key, value) = tokenizeDirective(rawLine) else { continue }
                switch key {
                case "include":
                    for pattern in unquoteTokens(value) {
                        for incURL in expandIncludePaths(pattern, sshDir: sshDir) {
                            let canonical = incURL.standardizedFileURL.path
                            if visited.contains(canonical) { continue }
                            visited.insert(canonical)
                            if let incText = read(incURL) {
                                parseText(incText)
                            }
                        }
                    }
                case "host":
                    blocks.append(ParsedBlock(patterns: unquoteTokens(value)))
                    currentIndex = blocks.count - 1
                case "match":
                    currentIndex = nil
                case "hostname":
                    if let idx = currentIndex {
                        blocks[idx].hostName = unquoteTokens(value).first
                    }
                case "user":
                    if let idx = currentIndex {
                        blocks[idx].user = unquoteTokens(value).first
                    }
                case "port":
                    if let idx = currentIndex,
                       let portStr = unquoteTokens(value).first,
                       let port = Int(portStr),
                       (1...65535).contains(port) {
                        blocks[idx].port = port
                    }
                default:
                    break
                }
            }

            for block in blocks {
                for pattern in block.patterns {
                    if pattern.isEmpty || pattern.hasPrefix("!") || pattern.contains("*") || pattern.contains("?") {
                        continue
                    }
                    if let existing = collectedMap[pattern] {
                        collectedMap[pattern] = SshHostInfo(
                            name: existing.name,
                            hostName: existing.hostName ?? block.hostName,
                            user: existing.user ?? block.user,
                            port: existing.port ?? block.port,
                            source: existing.source
                        )
                    } else {
                        collectedOrder.append(pattern)
                        collectedMap[pattern] = SshHostInfo(
                            name: pattern,
                            hostName: block.hostName,
                            user: block.user,
                            port: block.port,
                            source: "config"
                        )
                    }
                }
            }
        }

        parseText(content)
        return collectedOrder.compactMap { collectedMap[$0] }
    }

    static func normalizeTargetInput(_ raw: String) throws -> ParsedSshTargetInput {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw SshInputError.empty }
        if trimmed.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) {
            throw SshInputError.invalidCharacters
        }

        var port: Int?
        if trimmed.lowercased().hasPrefix("ssh "), trimmed.count > 4 {
            let tokens = trimmed.dropFirst(4).split(whereSeparator: { $0.isWhitespace }).map(String.init)
            var hostToken: String?
            var index = 0
            while index < tokens.count {
                let token = tokens[index]
                if token == "-p", index + 1 < tokens.count {
                    guard let parsed = Int(tokens[index + 1]), (1...65535).contains(parsed) else {
                        throw SshInputError.invalidPort
                    }
                    port = parsed
                    index += 2
                    continue
                } else if token.hasPrefix("-") {
                    throw SshInputError.unsupportedOption(token)
                } else {
                    hostToken = token
                }
                index += 1
            }
            trimmed = hostToken ?? ""
        }

        if let colonIndex = trimmed.lastIndex(of: ":"),
           colonIndex > trimmed.startIndex,
           !trimmed[trimmed.index(after: colonIndex)...].isEmpty {
            let hostPart = String(trimmed[..<colonIndex])
            let portPart = String(trimmed[trimmed.index(after: colonIndex)...])
            if portPart.allSatisfy(\.isNumber), portPart.count <= 5 {
                guard let parsed = Int(portPart), (1...65535).contains(parsed) else {
                    throw SshInputError.invalidPort
                }
                trimmed = hostPart
                port = port ?? parsed
            }
        }

        let forbidden = CharacterSet(charactersIn: " \t;|&$`<>\\'\"()")
        if trimmed.isEmpty
            || trimmed.hasPrefix("-")
            || trimmed.unicodeScalars.contains(where: { forbidden.contains($0) }) {
            throw SshInputError.invalidHost
        }

        return ParsedSshTargetInput(host: trimmed, port: port, label: trimmed)
    }

    static func buildSpawnArguments(
        target: SshTarget,
        idle: Bool = false,
        sessionPath: String? = nil
    ) throws -> [String] {
        let normalized = try normalizeTargetInput(target.host)
        let port = target.port ?? normalized.port

        var piArgs = ["pi", "--mode", "rpc", "--append-system-prompt",
                      shellSingleQuote(PiProcessHost.presentationPrompt)]
        if idle {
            piArgs.append(contentsOf: ["--no-session", "--no-extensions"])
        } else if let sessionPath, !sessionPath.isEmpty {
            piArgs.append(contentsOf: ["--session", shellSingleQuote(sessionPath)])
        }

        let remoteScript = [
            "export PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
            "cd \(shellDirExpression(target.remoteCwd)) || exit 1",
            "exec \(piArgs.joined(separator: " "))"
        ].joined(separator: "; ")

        var args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]
        if let port, (1...65535).contains(port) {
            args.append(contentsOf: ["-p", String(port)])
        }
        args.append(contentsOf: ["--", normalized.host, "sh -lc \(shellSingleQuote(remoteScript))"])
        return args
    }

    // MARK: - 私有解析辅助

    private static func stripComment(_ line: String) -> String {
        var inQuotes = false
        var result = ""
        for ch in line {
            if ch == "\"" { inQuotes.toggle() }
            if ch == "#", !inQuotes { break }
            result.append(ch)
        }
        return result
    }

    private static func tokenizeDirective(_ line: String) -> (String, String)? {
        let cleaned = stripComment(line).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        let pattern = #"^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
              let keyRange = Range(match.range(at: 1), in: cleaned),
              let valRange = Range(match.range(at: 2), in: cleaned) else {
            return nil
        }
        return (cleaned[keyRange].lowercased(), cleaned[valRange].trimmingCharacters(in: .whitespaces))
    }

    private static func unquoteTokens(_ raw: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var quote: Character?
        for ch in raw {
            if let q = quote {
                if ch == q { quote = nil }
                else { current.append(ch) }
            } else if ch == "\"" || ch == "'" {
                quote = ch
            } else if ch.isWhitespace {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                }
            } else {
                current.append(ch)
            }
        }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    private static func expandIncludePaths(_ pattern: String, sshDir: URL) -> [URL] {
        let expandedPath: String
        if pattern.hasPrefix("~/") {
            expandedPath = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(String(pattern.dropFirst(2))).path
        } else if pattern.hasPrefix("/") {
            expandedPath = pattern
        } else {
            expandedPath = sshDir.appendingPathComponent(pattern).path
        }

        if !expandedPath.contains("*"), !expandedPath.contains("?") {
            return [URL(fileURLWithPath: expandedPath)]
        }

        let url = URL(fileURLWithPath: expandedPath)
        let parent = url.deletingLastPathComponent()
        let fileGlob = url.lastPathComponent
        let regexPattern = "^" + NSRegularExpression.escapedPattern(for: fileGlob)
            .replacingOccurrences(of: "\\*", with: ".*")
            .replacingOccurrences(of: "\\?", with: ".") + "$"
        guard let regex = try? NSRegularExpression(pattern: regexPattern),
              let entries = try? FileManager.default.contentsOfDirectory(atPath: parent.path) else {
            return []
        }

        return entries
            .filter { entry in
                let range = NSRange(entry.startIndex..., in: entry)
                return regex.firstMatch(in: entry, range: range) != nil
            }
            .sorted()
            .map { parent.appendingPathComponent($0) }
    }

    private static func shellSingleQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private static func shellDirExpression(_ remoteCwd: String?) -> String {
        let trimmed = remoteCwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty || trimmed == "~" { return "\"$HOME\"" }
        if trimmed.hasPrefix("~/") {
            return "\"$HOME\"/\(shellSingleQuote(String(trimmed.dropFirst(2))))"
        }
        return shellSingleQuote(trimmed)
    }
}
