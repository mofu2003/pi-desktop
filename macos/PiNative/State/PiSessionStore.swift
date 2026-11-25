import AppKit
import Foundation
import Observation

enum SessionProjectTarget: Sendable {
    case keepCurrent
    case unassigned
    case project(ProjectInfo)
}

struct PendingUserMessage: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let images: [ImageAttachment]
    let isQueued: Bool
}

@Observable
@MainActor
final class PiSessionStore {
    var project: ProjectInfo?
    var unassignedWorkspace: ProjectInfo?
    var state: PiSessionState?
    var messages: [AgentMessage] = []
    var models: [PiModel] = []
    var stats: PiSessionStats?
    var commands: [PiCommandInfo] = []
    var toolExecutions: [String: ToolExecution] = [:]
    var isStreaming = false
    var isBashRunning = false
    var runningBash: (command: String, output: String)?
    var isConnecting = true
    var isRuntimeConnected = false
    var isRetrying = false
    var streamingBehavior: String = "steer" // steer | followUp
    var autoRetryEnabled = true
    var queuedMessages: (steering: [String], followUp: [String]) = ([], [])
    var activeSessionPath: String?
    private(set) var pendingUserMessages: [PendingUserMessage] = []
    var errorMessage: String?
    var notificationMessage: (status: String, text: String)?
    var statusText: String?
    var extensionRequest: ExtensionRequest?
    var commandStatuses: [String: String] = [:]
    var widgets: [String: ExtensionWidget] = [:]

    private let host = PiProcessHost()
    private var generation = 0
    private var isStarting = false
    private var eventLoopTask: Task<Void, Never>?

    // 流式增量微批缓冲，防止高频 token 触发全量重绘导致掉帧
    private var pendingTextDelta = ""
    private var pendingThinkingDelta = ""
    private var deltaFlushTask: Task<Void, Never>?

    init() {
        startListening()
    }

    func bootstrap() async {
        do {
            let workspace = try SessionStore.unassignedProject()
            unassignedWorkspace = workspace
            _ = await startSession(project: workspace, sessionPath: nil)
        } catch {
            isConnecting = false
            isRuntimeConnected = false
            errorMessage = error.localizedDescription
        }
    }

    func reconnect() async {
        errorMessage = nil
        let target: ProjectInfo
        if let project {
            target = project
        } else if let unassignedWorkspace {
            target = unassignedWorkspace
        } else if let fallback = try? SessionStore.unassignedProject() {
            unassignedWorkspace = fallback
            target = fallback
        } else {
            return
        }
        _ = await startSession(project: target, sessionPath: activeSessionPath)
    }

    func newSession(target: SessionProjectTarget = .unassigned) async -> Bool {
        if isStarting { return false }
        let fallbackWorkspace: ProjectInfo?
        if let unassignedWorkspace {
            fallbackWorkspace = unassignedWorkspace
        } else {
            fallbackWorkspace = try? SessionStore.unassignedProject()
            unassignedWorkspace = fallbackWorkspace
        }

        let resolvedTarget: ProjectInfo?
        switch target {
        case .keepCurrent:
            resolvedTarget = project ?? fallbackWorkspace
        case .unassigned:
            resolvedTarget = fallbackWorkspace
        case .project(let explicit):
            resolvedTarget = explicit
        }
        guard let targetProject = resolvedTarget else { return false }

        if state == nil || !Self.isSameProjectTarget(targetProject, project) {
            return await startSession(project: targetProject, sessionPath: nil)
        }

        let currentGen = generation
        isConnecting = true
        errorMessage = nil
        defer { if currentGen == generation { isConnecting = false } }

        do {
            if state?.isStreaming == true {
                _ = try await host.command(["type": .string("abort")])
            }
            let res = try await host.command(["type": .string("new_session")])
            if res["data"]?["cancelled"]?.boolValue == true { return false }
            queuedMessages = ([], [])
            pendingUserMessages.removeAll()
            await refreshAfterRun(generation: currentGen)
            return currentGen == generation
        } catch {
            if currentGen == generation { errorMessage = error.localizedDescription }
            return false
        }
    }

    func openSession(path: String, sourceProject: ProjectInfo) async -> Bool {
        await startSession(project: sourceProject, sessionPath: path)
    }

    func startSession(project selectedProject: ProjectInfo, sessionPath: String?) async -> Bool {
        if isStarting { return false }
        isStarting = true
        generation += 1
        let currentGen = generation
        deltaFlushTask?.cancel()
        deltaFlushTask = nil
        pendingTextDelta = ""
        pendingThinkingDelta = ""

        self.project = selectedProject
        isConnecting = true
        isRuntimeConnected = false
        errorMessage = nil
        statusText = nil
        isRetrying = false
        runningBash = nil
        queuedMessages = ([], [])
        pendingUserMessages.removeAll()
        widgets = [:]
        commandStatuses = [:]
        state = nil
        stats = nil
        messages = []
        toolExecutions = [:]
        activeSessionPath = sessionPath

        defer {
            isStarting = false
            if currentGen == generation { isConnecting = false }
        }

        do {
            let payload = try await host.start(
                cwd: selectedProject.path,
                sessionPath: sessionPath,
                ssh: selectedProject.ssh
            )
            if currentGen != generation { return false }
            isRuntimeConnected = true
            updateState(payload.state)
            messages = payload.messages
            toolExecutions = Self.toolResultMap(from: payload.messages)
            models = payload.models
            stats = payload.stats
            commands = payload.commands
            activeSessionPath = payload.state.sessionFile ?? sessionPath
            return true
        } catch {
            if currentGen == generation {
                errorMessage = error.localizedDescription
            }
            return false
        }
    }

    func send(text: String, images: [ImageAttachment] = []) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty && images.isEmpty { return false }

        if trimmed.hasPrefix("!") && images.isEmpty {
            let excludeFromContext = trimmed.hasPrefix("!!")
            let cmd = String(trimmed.dropFirst(excludeFromContext ? 2 : 1))
                .trimmingCharacters(in: .whitespaces)
            if cmd.isEmpty { return false }
            return await runBash(command: cmd, excludeFromContext: excludeFromContext)
        }

        if state == nil {
            errorMessage = "Pi 尚未连接，请点击重新连接后再试。"
            return false
        }

        errorMessage = nil
        let currentGen = generation
        let pending = PendingUserMessage(text: text, images: images, isQueued: isStreaming)
        pendingUserMessages.append(pending)

        do {
            var payload: [String: JSONValue] = [
                "type": .string("prompt"),
                "message": .string(text)
            ]
            if !images.isEmpty {
                let encoded = try JSONEncoder().encode(images)
                if let imgJson = try? JSONDecoder().decode(JSONValue.self, from: encoded) {
                    payload["images"] = imgJson
                }
            }
            if pending.isQueued {
                payload["streamingBehavior"] = .string(streamingBehavior)
            }
            _ = try await host.command(payload)
            return true
        } catch {
            pendingUserMessages.removeAll { $0.id == pending.id }
            if currentGen == generation { errorMessage = error.localizedDescription }
            return false
        }
    }

    func runBash(command: String, excludeFromContext: Bool) async -> Bool {
        isBashRunning = true
        runningBash = (command, "")
        errorMessage = nil
        let currentGen = generation
        defer {
            if currentGen == generation {
                isBashRunning = false
                runningBash = nil
            }
        }
        do {
            _ = try await host.command([
                "type": .string("bash"),
                "command": .string(command),
                "excludeFromContext": .bool(excludeFromContext)
            ])
            await refreshAfterRun(generation: currentGen)
            return true
        } catch {
            if currentGen == generation { errorMessage = error.localizedDescription }
            return false
        }
    }

    func stop() async {
        do {
            if isBashRunning {
                _ = try await host.command(["type": .string("abort_bash")])
                isBashRunning = false
                runningBash = nil
            } else {
                _ = try await host.command(["type": .string("abort")])
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearQueue() async {
        let clearedIDs = Set(pendingUserMessages.filter(\.isQueued).map(\.id))
        do {
            _ = try await host.command(["type": .string("clear_queue")])
            queuedMessages = ([], [])
            pendingUserMessages.removeAll { clearedIDs.contains($0.id) }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func abortRetry() async {
        do {
            _ = try await host.command(["type": .string("abort_retry")])
            isRetrying = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setModel(provider: String, modelId: String) async {
        do {
            _ = try await host.command([
                "type": .string("set_model"),
                "provider": .string(provider),
                "modelId": .string(modelId)
            ])
            await refreshStateOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setThinkingLevel(_ level: ThinkingLevel) async {
        do {
            _ = try await host.command([
                "type": .string("set_thinking_level"),
                "level": .string(level.rawValue)
            ])
            await refreshStateOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setSteeringMode(_ mode: String) async {
        do {
            _ = try await host.command([
                "type": .string("set_steering_mode"),
                "mode": .string(mode)
            ])
            await refreshStateOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setFollowUpMode(_ mode: String) async {
        do {
            _ = try await host.command([
                "type": .string("set_follow_up_mode"),
                "mode": .string(mode)
            ])
            await refreshStateOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setAutoCompaction(_ enabled: Bool) async {
        do {
            _ = try await host.command([
                "type": .string("set_auto_compaction"),
                "enabled": .bool(enabled)
            ])
            await refreshStateOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setAutoRetry(_ enabled: Bool) async {
        do {
            _ = try await host.command([
                "type": .string("set_auto_retry"),
                "enabled": .bool(enabled)
            ])
            autoRetryEnabled = enabled
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func compact(customInstructions: String? = nil) async -> Bool {
        let currentGen = generation
        do {
            var payload: [String: JSONValue] = ["type": .string("compact")]
            if let customInstructions, !customInstructions.isEmpty {
                payload["customInstructions"] = .string(customInstructions)
            }
            _ = try await host.command(payload)
            await refreshAfterRun(generation: currentGen)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func getForkMessages() async -> [ForkableMessage] {
        do {
            let res = try await host.command(["type": .string("get_fork_messages")])
            if let listVal = res["data"]?["messages"] {
                return try decodeValue(listVal)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        return []
    }

    func forkSession(entryId: String) async -> Bool {
        let currentGen = generation
        do {
            let res = try await host.command([
                "type": .string("fork"),
                "entryId": .string(entryId)
            ])
            if res["data"]?["cancelled"]?.boolValue == true { return false }
            await refreshAfterRun(generation: currentGen)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func cloneSession() async -> Bool {
        let currentGen = generation
        do {
            _ = try await host.command(["type": .string("clone")])
            await refreshAfterRun(generation: currentGen)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func exportSessionHtml() async {
        let panel = NSSavePanel()
        panel.title = "导出会话为 HTML"
        panel.nameFieldStringValue = "pi-session.html"
        panel.allowedContentTypes = [.html]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            _ = try await host.command([
                "type": .string("export_html"),
                "outputPath": .string(url.path)
            ])
            notificationMessage = ("success", "已导出 HTML：\(url.lastPathComponent)")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func copyLastAssistantText() async {
        do {
            let res = try await host.command(["type": .string("get_last_assistant_text")])
            if let text = res["data"]?["text"]?.stringValue, !text.isEmpty {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                notificationMessage = ("success", "已复制最后一条助手回复")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func respondToExtension(id: String, value: String? = nil, confirmed: Bool? = nil, cancelled: Bool = false) async {
        extensionRequest = nil
        var payload: [String: JSONValue] = [
            "type": .string("extension_ui_response"),
            "id": .string(id),
            "cancelled": .bool(cancelled)
        ]
        if let value { payload["value"] = .string(value) }
        if let confirmed { payload["confirmed"] = .bool(confirmed) }
        _ = try? await host.command(payload)
    }

    func renameActiveSession(to newName: String) async -> Bool {
        do {
            _ = try await host.command([
                "type": .string("set_session_name"),
                "name": .string(newName)
            ])
            await refreshStateOnly()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: - 事件流处理

    private func startListening() {
        let stream = host.events()
        eventLoopTask = Task { [weak self] in
            for await event in stream {
                guard let self else { break }
                self.handleHostEvent(event)
            }
        }
    }

    private func handleHostEvent(_ event: PiHostEvent) {
        switch event {
        case .hostError(let msg):
            isRuntimeConnected = false
            isStreaming = false
            isBashRunning = false
            errorMessage = msg
        case .hostStopped:
            isRuntimeConnected = false
            isStreaming = false
            isBashRunning = false
        case .protocolError(let raw):
            notificationMessage = ("warning", "协议解析异常：\(raw)")
        case .agentEnded(let decoded):
            flushPendingDeltas()
            isStreaming = false
            if let decoded {
                messages = decoded
                toolExecutions = Self.toolResultMap(from: decoded)
            }
            Task { [generation] in await refreshAfterRun(generation: generation) }
        case .rpcEvent(let dict):
            handleRpcEvent(dict)
        }
    }

    private func handleRpcEvent(_ dict: [String: JSONValue]) {
        guard let type = dict["type"]?.stringValue else { return }
        switch type {
        case "agent_start":
            isStreaming = true
        case "agent_settled":
            flushPendingDeltas()
            isStreaming = false
            isRetrying = false
        case "message_start":
            flushPendingDeltas()
            if let msgVal = dict["message"], let msg: AgentMessage = try? decodeValue(msgVal) {
                upsertMessage(msg)
            }
        case "message_update":
            if let assistantEvent = dict["assistantMessageEvent"]?.objectValue {
                applyAssistantUpdate(assistantEvent)
            }
        case "message_end":
            flushPendingDeltas()
            if let msgVal = dict["message"], let msg: AgentMessage = try? decodeValue(msgVal) {
                upsertMessage(msg)
            }
        case "tool_execution_start":
            if let callId = dict["toolCallId"]?.stringValue,
               let toolName = dict["toolName"]?.stringValue {
                let args = dict["args"]?.objectValue ?? [:]
                toolExecutions[callId] = ToolExecution(
                    toolCallId: callId,
                    toolName: toolName,
                    args: args,
                    output: "",
                    isError: false,
                    isRunning: true,
                    durationMs: nil,
                    startedAt: Date()
                )
            }
        case "tool_execution_update":
            if let callId = dict["toolCallId"]?.stringValue,
               var exec = toolExecutions[callId],
               let contentVal = dict["partialResult"]?["content"] {
                exec.output = extractContentText(contentVal)
                toolExecutions[callId] = exec
            }
        case "tool_execution_end":
            if let callId = dict["toolCallId"]?.stringValue,
               var exec = toolExecutions[callId] {
                if let contentVal = dict["result"]?["content"] {
                    exec.output = extractContentText(contentVal)
                }
                exec.isError = dict["isError"]?.boolValue ?? false
                exec.isRunning = false
                exec.durationMs = Date().timeIntervalSince(exec.startedAt) * 1000
                toolExecutions[callId] = exec
            }
        case "queue_update":
            let steering = dict["steering"]?.arrayValue?.compactMap(\.stringValue) ?? []
            let followUp = dict["followUp"]?.arrayValue?.compactMap(\.stringValue) ?? []
            queuedMessages = (steering, followUp)
        case "compaction_start":
            statusText = "正在压缩上下文…"
        case "compaction_end":
            statusText = nil
            if let err = dict["errorMessage"]?.stringValue, !err.isEmpty {
                errorMessage = err
            }
            Task { [generation] in await refreshAfterRun(generation: generation) }
        case "auto_retry_start":
            isRetrying = true
            let attempt = dict["attempt"]?.intValue ?? 1
            let maxAttempts = dict["maxAttempts"]?.intValue ?? 3
            statusText = "正在重试（第 \(attempt)/\(maxAttempts) 次）…"
        case "auto_retry_end":
            isRetrying = false
            statusText = nil
            if dict["success"]?.boolValue == false, let err = dict["finalError"]?.stringValue {
                errorMessage = err
            }
        case "bash_execution_update":
            if let delta = dict["delta"]?.stringValue, let current = runningBash {
                runningBash = (current.command, current.output + delta)
            }
        case "session_info_changed":
            if let name = dict["name"]?.stringValue {
                state?.sessionName = name
            }
        case "thinking_level_changed":
            if let raw = dict["level"]?.stringValue, let level = ThinkingLevel(rawValue: raw) {
                state?.thinkingLevel = level
            }
        case "extension_error":
            if let err = dict["error"]?.stringValue {
                errorMessage = err
            }
        case "extension_ui_request":
            handleExtensionRequest(dict)
        default:
            break
        }
    }

    private func handleExtensionRequest(_ dict: [String: JSONValue]) {
        guard let method = dict["method"]?.stringValue else { return }
        if method == "setStatus" {
            let key = dict["statusKey"]?.stringValue ?? "default"
            let val = dict["statusText"]?.stringValue
            if let val, !val.isEmpty {
                commandStatuses[key] = val
            } else {
                commandStatuses.removeValue(forKey: key)
            }
            return
        }
        if method == "setWidget" {
            let key = dict["widgetKey"]?.stringValue ?? "default"
            let lines = dict["widgetLines"]?.arrayValue?.compactMap(\.stringValue) ?? []
            let placement = dict["widgetPlacement"]?.stringValue ?? "aboveEditor"
            if lines.isEmpty {
                widgets.removeValue(forKey: key)
            } else {
                widgets[key] = ExtensionWidget(lines: lines, placement: placement)
            }
            return
        }
        if method == "notify" {
            let status = dict["notifyType"]?.stringValue ?? "info"
            let msg = dict["message"]?.stringValue ?? ""
            if !msg.isEmpty { notificationMessage = (status, msg) }
            return
        }
        if let id = dict["id"]?.stringValue {
            let title = dict["title"]?.stringValue ?? "扩展请求"
            let message = dict["message"]?.stringValue
            let options = dict["options"]?.arrayValue?.compactMap(\.stringValue) ?? []
            let placeholder = dict["placeholder"]?.stringValue
            let prefill = dict["prefill"]?.stringValue
            extensionRequest = ExtensionRequest(
                id: id,
                method: method,
                title: title,
                message: message,
                options: options,
                placeholder: placeholder,
                prefill: prefill
            )
        }
    }

    private func upsertMessage(_ msg: AgentMessage) {
        if let idx = messages.lastIndex(where: { $0.role == msg.role && abs($0.timestamp - msg.timestamp) < 1 }) {
            messages[idx] = msg
        } else {
            if msg.role == "user", !pendingUserMessages.isEmpty {
                let text = msg.content?.plainText.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let index = pendingUserMessages.firstIndex {
                    $0.text.trimmingCharacters(in: .whitespacesAndNewlines) == text
                } ?? pendingUserMessages.firstIndex { !$0.isQueued }
                if let index { pendingUserMessages.remove(at: index) }
            }
            messages.append(msg)
        }
    }

    private func applyAssistantUpdate(_ event: [String: JSONValue]) {
        guard let kind = event["type"]?.stringValue else { return }
        switch kind {
        case "text_delta":
            if let delta = event["delta"]?.stringValue, !delta.isEmpty {
                if !pendingThinkingDelta.isEmpty { flushPendingDeltas() }
                pendingTextDelta += delta
                scheduleDeltaFlush()
            }
        case "thinking_delta":
            if let delta = event["delta"]?.stringValue, !delta.isEmpty {
                if !pendingTextDelta.isEmpty { flushPendingDeltas() }
                pendingThinkingDelta += delta
                scheduleDeltaFlush()
            }
        case "thinking_end":
            flushPendingDeltas()
            if let full = event["content"]?.stringValue {
                mutateAssistantBlocks { blocks in
                    if let lastThinkingIdx = blocks.lastIndex(where: {
                        if case .thinking = $0 { return true }
                        return false
                    }) {
                        blocks[lastThinkingIdx] = .thinking(full, redacted: false)
                    }
                }
            }
        case "toolcall_end":
            flushPendingDeltas()
            if let tcVal = event["toolCall"], let block: ContentBlock = try? decodeValue(tcVal) {
                mutateAssistantBlocks { blocks in
                    blocks.append(block)
                }
            }
        default:
            break
        }
    }

    private func scheduleDeltaFlush() {
        guard deltaFlushTask == nil else { return }
        deltaFlushTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(32))
            } catch {
                return
            }
            self?.flushPendingDeltas()
        }
    }

    private func flushPendingDeltas() {
        deltaFlushTask?.cancel()
        deltaFlushTask = nil
        guard !pendingThinkingDelta.isEmpty || !pendingTextDelta.isEmpty else { return }
        let thinking = pendingThinkingDelta
        let text = pendingTextDelta
        pendingThinkingDelta = ""
        pendingTextDelta = ""

        mutateAssistantBlocks { blocks in
            if !thinking.isEmpty {
                if case .thinking(let existing, let redacted) = blocks.last {
                    blocks[blocks.count - 1] = .thinking(existing + thinking, redacted: redacted)
                } else {
                    blocks.append(.thinking(thinking, redacted: false))
                }
            }
            if !text.isEmpty {
                if case .text(let existing) = blocks.last {
                    blocks[blocks.count - 1] = .text(existing + text)
                } else {
                    blocks.append(.text(text))
                }
            }
        }
    }

    private func mutateAssistantBlocks(_ transform: (inout [ContentBlock]) -> Void) {
        var idx = messages.lastIndex(where: { $0.role == "assistant" })
        if idx == nil {
            let placeholder = AgentMessage(
                role: "assistant",
                content: .blocks([]),
                api: nil,
                provider: nil,
                model: state?.model?.id,
                responseModel: nil,
                usage: nil,
                stopReason: "pending",
                errorMessage: nil,
                timestamp: Date().timeIntervalSince1970 * 1000,
                durationMs: nil,
                toolCallId: nil,
                toolName: nil,
                details: nil,
                isError: nil,
                command: nil,
                output: nil,
                exitCode: nil,
                cancelled: nil,
                truncated: nil,
                fullOutputPath: nil,
                excludeFromContext: nil,
                customType: nil,
                display: nil,
                summary: nil,
                fromId: nil,
                tokensBefore: nil
            )
            messages.append(placeholder)
            idx = messages.count - 1
        }
        guard let targetIdx = idx else { return }
        var blocks = messages[targetIdx].content?.blocks ?? []
        transform(&blocks)
        messages[targetIdx].content = .blocks(blocks)
    }

    private func updateState(_ next: PiSessionState?) {
        state = next
        isStreaming = next?.isStreaming ?? false
        if let file = next?.sessionFile {
            activeSessionPath = file
        }
    }

    private func refreshStateOnly() async {
        let targetGen = generation
        guard let res = try? await host.command(["type": .string("get_state")]),
              targetGen == generation,
              let data = res["data"],
              var next: PiSessionState = try? decodeValue(data) else {
            return
        }
        if let lvRes = try? await host.command(["type": .string("get_available_thinking_levels")]),
           let lvData = lvRes["data"]?["levels"],
           let levels: [ThinkingLevel] = try? decodeValue(lvData) {
            next.availableThinkingLevels = levels
        }
        if targetGen == generation { updateState(next) }
    }

    private func refreshAfterRun(generation targetGen: Int) async {
        guard targetGen == generation else { return }
        await refreshStateOnly()
        guard targetGen == generation else { return }
        if let decoded = try? await host.getMessages() {
            if targetGen == generation, messages != decoded {
                messages = decoded
                toolExecutions = Self.toolResultMap(from: decoded)
            }
        }
        guard targetGen == generation else { return }
        if let statRes = try? await host.command(["type": .string("get_session_stats")]),
           let statData = statRes["data"],
           let decoded: PiSessionStats = try? decodeValue(statData) {
            if targetGen == generation { stats = decoded }
        }
        guard targetGen == generation else { return }
        statusText = nil
        isRetrying = false
    }

    private static func toolResultMap(from messages: [AgentMessage]) -> [String: ToolExecution] {
        var map: [String: ToolExecution] = [:]
        for message in messages {
            for block in message.content?.blocks ?? [] {
                if case .toolCall(let id, let name, let args) = block {
                    map[id] = ToolExecution(
                        toolCallId: id,
                        toolName: name,
                        args: args,
                        output: "",
                        isError: false,
                        isRunning: false,
                        durationMs: nil,
                        startedAt: Date(timeIntervalSince1970: message.timestamp / 1000)
                    )
                }
            }
            if message.role == "toolResult", let callId = message.toolCallId {
                var existing = map[callId] ?? ToolExecution(
                    toolCallId: callId,
                    toolName: message.toolName ?? "tool",
                    args: [:],
                    output: "",
                    isError: false,
                    isRunning: false,
                    durationMs: nil,
                    startedAt: Date()
                )
                existing.output = message.content?.plainText ?? ""
                existing.isError = message.isError ?? false
                existing.isRunning = false
                existing.durationMs = message.durationMs
                map[callId] = existing
            }
        }
        return map
    }

    private static func isSameProjectTarget(_ a: ProjectInfo?, _ b: ProjectInfo?) -> Bool {
        guard let a, let b else { return a == nil && b == nil }
        return a.path == b.path
            && a.ssh?.host == b.ssh?.host
            && a.ssh?.remoteCwd == b.ssh?.remoteCwd
            && a.ssh?.port == b.ssh?.port
    }

    private func extractContentText(_ value: JSONValue) -> String {
        switch value {
        case .string(let s):
            return s
        case .array(let items):
            return items.compactMap { $0["text"]?.stringValue }.joined(separator: "\n")
        default:
            return ""
        }
    }

    private func decodeValue<T: Decodable>(_ value: JSONValue) throws -> T {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private extension JSONValue {
    subscript(key: String) -> JSONValue? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }
}
