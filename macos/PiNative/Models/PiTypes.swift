import Foundation

// MARK: - 通用 JSON 值

enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.typeMismatch(
                JSONValue.self,
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unsupported JSON value")
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var doubleValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    var intValue: Int? {
        if case .number(let n) = self { return Int(n) }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case .array(let arr) = self { return arr }
        return nil
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let obj) = self { return obj }
        return nil
    }

    var prettyPrinted: String {
        switch self {
        case .null:
            return "null"
        case .bool(let b):
            return b ? "true" : "false"
        case .number(let n):
            if n.rounded() == n, abs(n) < Double(Int.max) {
                return String(Int(n))
            }
            return String(n)
        case .string(let s):
            return s
        case .array, .object:
            guard let data = try? JSONEncoder.pretty.encode(self),
                  let text = String(data: data, encoding: .utf8) else {
                return ""
            }
            return text
        }
    }
}

private extension JSONEncoder {
    static let pretty: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()
}

// MARK: - 思考档位与图片附件

enum ThinkingLevel: String, Codable, CaseIterable, Sendable {
    case off
    case minimal
    case low
    case medium
    case high
    case xhigh
    case max

    var displayName: String {
        switch self {
        case .off: return "关闭"
        case .minimal: return "极简"
        case .low: return "低"
        case .medium: return "中"
        case .high: return "高"
        case .xhigh: return "极高"
        case .max: return "最高"
        }
    }
}

struct ImageAttachment: Codable, Sendable, Equatable, Identifiable {
    var id: String { "\(mimeType):\(data.prefix(24)):\(data.count)" }
    let type: String
    let data: String
    let mimeType: String

    init(data: String, mimeType: String) {
        self.type = "image"
        self.data = data
        self.mimeType = mimeType
    }
}

// MARK: - 消息内容块与消息模型

enum ContentBlock: Codable, Sendable, Equatable {
    case text(String)
    case thinking(String, redacted: Bool)
    case toolCall(id: String, name: String, arguments: [String: JSONValue])
    case image(data: String, mimeType: String)

    enum CodingKeys: String, CodingKey {
        case type, text, thinking, redacted, id, name, arguments, data, mimeType
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "text":
            self = .text(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
        case "thinking":
            let thinking = try container.decodeIfPresent(String.self, forKey: .thinking) ?? ""
            let redacted = try container.decodeIfPresent(Bool.self, forKey: .redacted) ?? false
            self = .thinking(thinking, redacted: redacted)
        case "toolCall":
            let id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
            let name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
            let arguments = try container.decodeIfPresent([String: JSONValue].self, forKey: .arguments) ?? [:]
            self = .toolCall(id: id, name: name, arguments: arguments)
        case "image":
            let data = try container.decodeIfPresent(String.self, forKey: .data) ?? ""
            let mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType) ?? "image/png"
            self = .image(data: data, mimeType: mimeType)
        default:
            self = .text(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .thinking(let thinking, let redacted):
            try container.encode("thinking", forKey: .type)
            try container.encode(thinking, forKey: .thinking)
            if redacted { try container.encode(true, forKey: .redacted) }
        case .toolCall(let id, let name, let arguments):
            try container.encode("toolCall", forKey: .type)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .name)
            try container.encode(arguments, forKey: .arguments)
        case .image(let data, let mimeType):
            try container.encode("image", forKey: .type)
            try container.encode(data, forKey: .data)
            try container.encode(mimeType, forKey: .mimeType)
        }
    }
}

enum MessageContent: Codable, Sendable, Equatable {
    case text(String)
    case blocks([ContentBlock])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) {
            self = .text(s)
        } else if let blocks = try? container.decode([ContentBlock].self) {
            self = .blocks(blocks)
        } else {
            self = .text("")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let s): try container.encode(s)
        case .blocks(let b): try container.encode(b)
        }
    }

    var plainText: String {
        switch self {
        case .text(let s): return s
        case .blocks(let blocks):
            return blocks.compactMap {
                if case .text(let text) = $0 { return text }
                return nil
            }.joined(separator: "\n")
        }
    }

    var blocks: [ContentBlock] {
        switch self {
        case .text(let s): return s.isEmpty ? [] : [.text(s)]
        case .blocks(let b): return b
        }
    }
}

struct AgentUsage: Codable, Sendable, Equatable {
    struct Cost: Codable, Sendable, Equatable {
        let input: Double?
        let output: Double?
        let cacheRead: Double?
        let cacheWrite: Double?
        let total: Double?
    }

    let input: Int?
    let output: Int?
    let cacheRead: Int?
    let cacheWrite: Int?
    let totalTokens: Int?
    let cost: Cost?
}

struct AgentMessage: Codable, Sendable, Equatable, Identifiable {
    var id: String { "\(role):\(Int64(timestamp)):\(toolCallId ?? "")" }

    let role: String
    var content: MessageContent?
    let api: String?
    let provider: String?
    let model: String?
    let responseModel: String?
    var usage: AgentUsage?
    var stopReason: String?
    var errorMessage: String?
    let timestamp: Double
    var durationMs: Double?

    // toolResult 字段
    let toolCallId: String?
    let toolName: String?
    let details: JSONValue?
    let isError: Bool?

    // bashExecution 字段
    let command: String?
    let output: String?
    let exitCode: Int?
    let cancelled: Bool?
    let truncated: Bool?
    let fullOutputPath: String?
    let excludeFromContext: Bool?

    // custom / summary 字段
    let customType: String?
    let display: Bool?
    let summary: String?
    let fromId: String?
    let tokensBefore: Int?
}

// MARK: - 会话状态、统计、模型与命令

struct PiModel: Codable, Sendable, Equatable, Identifiable {
    var idKey: String { "\(provider):\(id)" }
    let id: String
    let name: String?
    let provider: String
    let api: String?
    let reasoning: Bool?
    let thinkingLevelMap: [String: String?]?
    let contextWindow: Int?
    let maxTokens: Int?

    var displayName: String {
        if let name, !name.isEmpty { return name }
        return id
    }
}

struct PiSessionState: Codable, Sendable, Equatable {
    var model: PiModel?
    var thinkingLevel: ThinkingLevel
    var availableThinkingLevels: [ThinkingLevel]?
    var isStreaming: Bool
    var isCompacting: Bool
    var steeringMode: String
    var followUpMode: String
    var sessionFile: String?
    var sessionId: String
    var sessionName: String?
    var autoCompactionEnabled: Bool
    var messageCount: Int
    var pendingMessageCount: Int
}

struct PiSessionStats: Codable, Sendable, Equatable {
    struct Tokens: Codable, Sendable, Equatable {
        let input: Int
        let output: Int
        let cacheRead: Int
        let cacheWrite: Int
        let total: Int
    }

    struct ContextUsage: Codable, Sendable, Equatable {
        let tokens: Int?
        let contextWindow: Int
        let percent: Double?
    }

    let sessionFile: String?
    let sessionId: String
    let userMessages: Int
    let assistantMessages: Int
    let toolCalls: Int
    let toolResults: Int
    let totalMessages: Int
    let tokens: Tokens
    let cost: Double
    let contextUsage: ContextUsage?
}

struct PiCommandInfo: Codable, Sendable, Equatable, Identifiable {
    var id: String { "\(source):\(name)" }
    let name: String
    let description: String?
    let source: String
}

struct ToolExecution: Sendable, Equatable, Identifiable {
    var id: String { toolCallId }
    let toolCallId: String
    let toolName: String
    var args: [String: JSONValue]
    var output: String
    var isError: Bool
    var isRunning: Bool
    var durationMs: Double?
    var startedAt: Date
}

struct ForkableMessage: Codable, Sendable, Equatable, Identifiable {
    var id: String { entryId }
    let entryId: String
    let text: String
}

// MARK: - 项目、SSH 与本地库模型

struct SshHostInfo: Codable, Sendable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let hostName: String?
    let user: String?
    let port: Int?
    let source: String
}

struct SshTarget: Codable, Sendable, Equatable, Hashable {
    let host: String
    var label: String?
    var remoteCwd: String?
    var port: Int?

    var displayLabel: String {
        if let label, !label.isEmpty { return label }
        return host
    }
}

struct ProjectInfo: Codable, Sendable, Equatable, Identifiable, Hashable {
    var id: String {
        if let ssh {
            return "ssh:\(ssh.host):\(ssh.port ?? 0):\(ssh.remoteCwd ?? "~")"
        }
        return path
    }

    let path: String
    let name: String
    var isUnassigned: Bool?
    var ssh: SshTarget?
}

struct SessionSummary: Codable, Sendable, Equatable, Identifiable, Hashable {
    var id: String { path }
    let sessionId: String
    let path: String
    let cwd: String
    var name: String?
    var title: String
    var preview: String
    var messageCount: Int
    var created: Date
    var modified: Date
}

struct CustomizationResource: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let kind: String // skills | mcp | extensions
    let scope: String // user | project
    let name: String
    let description: String?
    let location: String
}

struct ExtensionRequest: Sendable, Equatable, Identifiable {
    let id: String
    let method: String // select | confirm | input | editor
    let title: String
    let message: String?
    let options: [String]
    let placeholder: String?
    let prefill: String?
}

struct ExtensionWidget: Sendable, Equatable {
    let lines: [String]
    let placement: String // aboveEditor | belowEditor
}

struct BootstrapPayload: Sendable {
    let cwd: String
    let piPath: String
    let ssh: SshTarget?
    let state: PiSessionState
    let messages: [AgentMessage]
    let models: [PiModel]
    let stats: PiSessionStats?
    let commands: [PiCommandInfo]
}
