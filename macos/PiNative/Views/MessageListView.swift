import AppKit
import SwiftUI

struct MessageListView: View, Equatable {
    let messages: [AgentMessage]
    let toolExecutions: [String: ToolExecution]
    let runningBash: (command: String, output: String)?
    let pendingUserMessages: [PendingUserMessage]
    let isStreaming: Bool
    let onColumnChange: (CGRect) -> Void
    var onOpenFile: ((String, Int?, Int?) -> Void)? = nil

    @State private var lastScrollAt: Date = .distantPast

    nonisolated static func == (lhs: MessageListView, rhs: MessageListView) -> Bool {
        lhs.isStreaming == rhs.isStreaming
            && lhs.runningBash?.command == rhs.runningBash?.command
            && lhs.runningBash?.output == rhs.runningBash?.output
            && lhs.pendingUserMessages == rhs.pendingUserMessages
            && lhs.messages == rhs.messages
            && lhs.toolExecutions == rhs.toolExecutions
    }

    private enum ConversationItem: Identifiable {
        case user(AgentMessage)
        case assistantTurn(AssistantTurn)
        case bash(AgentMessage)
        case note(AgentMessage)

        var id: String {
            switch self {
            case .user(let msg), .bash(let msg), .note(let msg):
                return msg.id
            case .assistantTurn(let turn):
                return turn.id
            }
        }
    }

    private struct AssistantTurn: Equatable {
        struct ToolCall: Equatable {
            let id: String
            let name: String
            let args: [String: JSONValue]
        }

        let id: String
        let thinkingBlocks: [String]
        let toolCalls: [ToolCall]
        let textSegments: [String]
        let imageAttachments: [ImageAttachment]
        let errorMessages: [String]
        let elapsedMs: Double?
        let usage: AgentUsage?
        let completedTimestampMs: Double?
        let isActiveTurn: Bool

    }

    private var conversationItems: [ConversationItem] {
        var items: [ConversationItem] = []
        var index = 0

        while index < messages.count {
            let msg = messages[index]
            switch msg.role {
            case "user":
                items.append(.user(msg))
                index += 1

            case "bashExecution":
                items.append(.bash(msg))
                index += 1

            case "compactionSummary", "branchSummary", "custom", "system":
                if msg.role != "custom" && msg.role != "system" || msg.display != false {
                    items.append(.note(msg))
                }
                index += 1

            case "assistant", "toolResult":
                var thinkingBlocks: [String] = []
                var toolCalls: [AssistantTurn.ToolCall] = []
                var textSegments: [String] = []
                var images: [ImageAttachment] = []
                var errors: [String] = []
                var totalDurationMs = 0.0
                var hasDuration = false
                var lastUsage: AgentUsage?
                var lastTimestamp: Double?
                let turnId = "turn:\(msg.id)"

                while index < messages.count,
                      messages[index].role == "assistant" || messages[index].role == "toolResult" {
                    let current = messages[index]
                    if let duration = current.durationMs, duration.isFinite, duration >= 0 {
                        totalDurationMs += duration
                        hasDuration = true
                    }
                    if current.role == "assistant" {
                        if let u = current.usage { lastUsage = u }
                        lastTimestamp = current.timestamp
                        if let err = current.errorMessage, !err.isEmpty { errors.append(err) }
                        for block in current.content?.blocks ?? [] {
                            switch block {
                            case .thinking(let text, let redacted):
                                let value = redacted ? "（思考内容已脱敏）" : text
                                if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    thinkingBlocks.append(value)
                                }
                            case .toolCall(let id, let name, let args):
                                toolCalls.append(.init(id: id, name: name, args: args))
                            case .text(let text):
                                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    textSegments.append(text)
                                }
                            case .image(let data, let mime):
                                images.append(ImageAttachment(data: data, mimeType: mime))
                            }
                        }
                    }
                    index += 1
                }

                let isLastTurn = index == messages.count
                let turn = AssistantTurn(
                    id: turnId,
                    thinkingBlocks: thinkingBlocks,
                    toolCalls: toolCalls,
                    textSegments: textSegments,
                    imageAttachments: images,
                    errorMessages: errors,
                    elapsedMs: hasDuration ? totalDurationMs : nil,
                    usage: lastUsage,
                    completedTimestampMs: lastTimestamp,
                    isActiveTurn: isStreaming && isLastTurn
                )
                items.append(.assistantTurn(turn))

            default:
                index += 1
            }
        }
        return items
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(conversationItems) { item in
                        switch item {
                        case .user(let msg):
                            let images: [ImageAttachment] = msg.content?.blocks.compactMap {
                                if case .image(let data, let mime) = $0 { return ImageAttachment(data: data, mimeType: mime) }
                                return nil
                            } ?? []
                            UserBubbleView(text: msg.content?.plainText ?? "", images: images)
                                .id(item.id)

                        case .assistantTurn(let turn):
                            AssistantTurnView(
                                turn: turn,
                                toolExecutions: turn.toolCalls.reduce(into: [:]) { executions, call in
                                    executions[call.id] = toolExecutions[call.id]
                                },
                                onOpenFile: onOpenFile
                            )
                                .equatable()
                                .id(item.id)

                        case .bash(let msg):
                            BashExecutionCardView(
                                command: msg.command ?? "",
                                output: msg.output ?? "",
                                exitCode: msg.exitCode,
                                isRunning: false
                            )
                            .id(item.id)

                        case .note(let msg):
                            SummaryNoteView(
                                title: msg.role == "compactionSummary"
                                    ? "上下文已压缩"
                                    : (msg.role == "branchSummary"
                                       ? "分支摘要"
                                       : (msg.role == "system" ? "系统提示" : (msg.customType ?? "扩展消息"))),
                                bodyText: msg.summary ?? msg.content?.plainText ?? ""
                            )
                            .id(item.id)
                        }
                    }

                    if let runningBash {
                        BashExecutionCardView(
                            command: runningBash.command,
                            output: runningBash.output,
                            exitCode: nil,
                            isRunning: true
                        )
                        .id("running-bash")
                    }

                    ForEach(pendingUserMessages) { pending in
                        UserBubbleView(text: pending.text, images: pending.images)
                    }

                    Color.clear
                        .frame(height: 150)
                        .id("bottom-anchor")
                }
                .frame(maxWidth: ConversationLayout.columnWidth, alignment: .leading)
                .onGeometryChange(for: CGRect.self) { proxy in
                    let frame = proxy.frame(in: .named(ConversationLayout.coordinateSpace))
                    return CGRect(x: frame.minX, y: 0, width: frame.width, height: 0)
                } action: { frame in
                    if frame.width > 0 { onColumnChange(frame) }
                }
                .padding(.horizontal, ConversationLayout.horizontalInset)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: messages.count) { _, _ in
                lastScrollAt = Date()
                withAnimation(.easeOut(duration: 0.14)) {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
            .onChange(of: pendingUserMessages.last?.id, initial: true) { previous, next in
                guard let next, previous != next || messages.isEmpty else { return }
                lastScrollAt = Date()
                proxy.scrollTo("bottom-anchor", anchor: .bottom)
            }
            .onChange(of: messages.last?.content?.plainText.count ?? 0) { _, _ in
                guard isStreaming else { return }
                let now = Date()
                if now.timeIntervalSince(lastScrollAt) >= 0.11 {
                    lastScrollAt = now
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
            .onChange(of: isStreaming) { _, streaming in
                if !streaming {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
        }
    }

    // MARK: - 单个助手回答回合视图（顶部用时与思考/工具折叠 + 正文 + 底部复制与 Token 消耗）

    private struct AssistantTurnView: View, Equatable {
        nonisolated static func == (lhs: AssistantTurnView, rhs: AssistantTurnView) -> Bool {
            lhs.turn == rhs.turn && lhs.toolExecutions == rhs.toolExecutions
        }

        let turn: AssistantTurn
        let toolExecutions: [String: ToolExecution]
        var onOpenFile: ((String, Int?, Int?) -> Void)? = nil

        @State private var isProcessExpanded = false
        @State private var copied = false
        @State private var showUsageDetail = false

        private var hasCollapsibleProcess: Bool {
            !turn.thinkingBlocks.isEmpty || !turn.toolCalls.isEmpty || turn.elapsedMs != nil || turn.isActiveTurn
        }

        private var fullResponseText: String {
            turn.textSegments.joined(separator: "\n\n")
        }

        private var totalTokens: Int? {
            guard let u = turn.usage else { return nil }
            if let total = u.totalTokens, total >= 0 { return total }
            let sum = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)
            return sum > 0 ? sum : nil
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 12) {
                // 1. 回答最上面：用时 + 思考过程与工具使用默认折叠区
                if hasCollapsibleProcess {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                isProcessExpanded.toggle()
                            }
                        } label: {
                            HStack(spacing: 6) {
                                if turn.isActiveTurn {
                                    ProgressView()
                                        .controlSize(.mini)
                                }
                                Text(headerSummaryText)
                                    .font(.system(size: 14))
                                    .foregroundStyle(.secondary)
                                if !turn.thinkingBlocks.isEmpty || !turn.toolCalls.isEmpty {
                                    Image(systemName: isProcessExpanded ? "chevron.up" : "chevron.down")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 3)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if isProcessExpanded || turn.isActiveTurn {
                            VStack(alignment: .leading, spacing: 7) {
                                if isProcessExpanded {
                                    ForEach(Array(turn.thinkingBlocks.enumerated()), id: \.offset) { _, thinking in
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text("思考过程")
                                                .font(.callout.weight(.semibold))
                                                .foregroundStyle(.secondary)
                                            Text(thinking)
                                                .font(.system(size: 13.5))
                                                .foregroundStyle(.secondary)
                                                .textSelection(.enabled)
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                                .fill(Color.primary.opacity(0.035))
                                        )
                                    }
                                }

                                ForEach(turn.toolCalls, id: \.id) { tc in
                                    ToolExecutionCardView(
                                        toolName: tc.name,
                                        args: tc.args,
                                        execution: toolExecutions[tc.id],
                                        onOpenFile: onOpenFile
                                    )
                                }
                            }
                            .padding(.leading, 14)
                        }
                    }
                }

                // 2. 中间回答正文
                ForEach(Array(turn.textSegments.enumerated()), id: \.offset) { _, text in
                    RichMarkdownView(markdown: text).equatable()
                }

                ForEach(turn.imageAttachments) { attachment in
                    if let raw = Data(base64Encoded: attachment.data), let img = NSImage(data: raw) {
                        Image(nsImage: img)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }

                ForEach(Array(turn.errorMessages.enumerated()), id: \.offset) { _, err in
                    Text(err)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }

                // 3. 回答最下面：复制按钮 + Token 消耗 + 时间
                if !turn.isActiveTurn && (!fullResponseText.isEmpty || totalTokens != nil) {
                    HStack(spacing: 16) {
                        if !fullResponseText.isEmpty {
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(fullResponseText, forType: .string)
                                copied = true
                                Task {
                                    try? await Task.sleep(for: .seconds(1.5))
                                    copied = false
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                    if copied {
                                        Text("已复制")
                                    }
                                }
                                .font(.system(size: 13.5))
                                .foregroundStyle(copied ? Color.accentColor : Color.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("复制回答")
                        }

                        if let tokens = totalTokens {
                            Button {
                                showUsageDetail.toggle()
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "cylinder.split.1x2")
                                    Text("用量 \(formatCompactTokens(tokens))")
                                }
                                .font(.system(size: 13.5))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .popover(isPresented: $showUsageDetail, arrowEdge: .bottom) {
                                if let u = turn.usage {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("本条回答 Token 消耗")
                                            .font(.headline)
                                        usageRow("输入", u.input)
                                        usageRow("缓存读取", u.cacheRead)
                                        usageRow("缓存写入", u.cacheWrite)
                                        usageRow("输出", u.output)
                                        Divider()
                                        usageRow("合计", tokens)
                                    }
                                    .padding(14)
                                    .frame(width: 210)
                                }
                            }
                        }

                        if let ts = turn.completedTimestampMs {
                            Text(formatLocalTimestamp(ts))
                                .font(.system(size: 13.5))
                                .foregroundStyle(.tertiary)
                        }

                        Spacer()
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        private var headerSummaryText: String {
            var parts: [String] = []
            if turn.isActiveTurn {
                parts.append(turn.toolCalls.contains(where: { toolExecutions[$0.id]?.isRunning == true }) ? "正在执行工具" : "正在思考")
            } else {
                parts.append(turn.toolCalls.isEmpty ? "已完成" : "工具调用 \(turn.toolCalls.count) 次")
            }
            if let elapsed = turn.elapsedMs {
                parts.append("用时 \(formatElapsed(elapsed))")
            }
            return parts.joined(separator: "，")
        }

        private func usageRow(_ label: String, _ count: Int?) -> some View {
            HStack {
                Text(label).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Text(count.map { "\($0.formatted()) tok" } ?? "—")
                    .font(.callout)
                    .monospacedDigit()
            }
        }

        private func formatElapsed(_ ms: Double) -> String {
            let totalSeconds = max(0, Int((ms / 1000.0).rounded(.up)))
            if totalSeconds == 0 { return "不到 1 秒" }
            if totalSeconds < 60 { return "\(totalSeconds) 秒" }
            let minutes = totalSeconds / 60
            let seconds = totalSeconds % 60
            if minutes < 60 { return seconds == 0 ? "\(minutes) 分" : "\(minutes) 分 \(seconds) 秒" }
            let hours = minutes / 60
            let restMinutes = minutes % 60
            return restMinutes == 0 ? "\(hours) 小时" : "\(hours) 小时 \(restMinutes) 分"
        }

        private func formatCompactTokens(_ count: Int) -> String {
            if count >= 1_000_000 {
                return String(format: "%.1fM tok", Double(count) / 1_000_000.0)
            }
            if count >= 1_000 {
                return String(format: "%.1fK tok", Double(count) / 1_000.0)
            }
            return "\(count) tok"
        }

        private func formatLocalTimestamp(_ ms: Double) -> String {
            let date = Date(timeIntervalSince1970: ms / 1000.0)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "zh_CN")
            formatter.dateFormat = "M月d日 HH:mm"
            return formatter.string(from: date)
        }
    }
}

private struct UserBubbleView: View {
    let text: String
    let images: [ImageAttachment]
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 8) {
                if !images.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(images) { item in
                            if let data = Data(base64Encoded: item.data), let image = NSImage(data: data) {
                                Image(nsImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 72, height: 72)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                }
                if !text.isEmpty {
                    Text(text)
                        .font(.system(size: 15))
                        .textSelection(.enabled)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Color(nsColor: .systemBlue).opacity(colorScheme == .dark ? 0.24 : 0.13),
                        in: .rect(cornerRadius: 14))
        }
    }
}

private struct ToolExecutionCardView: View {
    let toolName: String
    let args: [String: JSONValue]
    let execution: ToolExecution?
    var onOpenFile: ((String, Int?, Int?) -> Void)? = nil
    @State private var isExpanded = false

    private var normalizedName: String { toolName.lowercased() }
    private var command: String? { args["command"]?.stringValue }
    private var path: String? { args["path"]?.stringValue }
    private var isRunning: Bool { execution?.isRunning == true }
    private var isError: Bool { execution?.isError == true }

    private var fileName: String? {
        guard let path, !path.isEmpty else { return nil }
        let name = (path as NSString).lastPathComponent
        return name.isEmpty ? path : name
    }

    private var lineRangeBounds: (start: Int, end: Int)? {
        guard normalizedName == "read", let offset = args["offset"]?.intValue, offset > 0 else { return nil }
        if let limit = args["limit"]?.intValue, limit > 1 {
            return (offset, offset + limit - 1)
        }
        return (offset, offset)
    }

    private var lineRangeSuffix: String? {
        guard let bounds = lineRangeBounds else { return nil }
        if bounds.end > bounds.start {
            return "#L\(bounds.start)-\(bounds.end)"
        }
        return "#L\(bounds.start)"
    }

    private var diffCounts: (added: Int, removed: Int)? {
        switch normalizedName {
        case "write":
            let content = args["content"]?.stringValue ?? ""
            let added = content.isEmpty ? 0 : content.components(separatedBy: "\n").count
            return (added, 0)
        case "edit":
            let replacements = args["edits"]?.arrayValue?.compactMap(\.objectValue) ?? [args]
            var added = 0
            var removed = 0
            for item in replacements {
                if let old = item["oldText"]?.stringValue, !old.isEmpty {
                    removed += old.components(separatedBy: "\n").count
                }
                if let new = item["newText"]?.stringValue, !new.isEmpty {
                    added += new.components(separatedBy: "\n").count
                }
            }
            return (added == 0 && removed == 0) ? nil : (added, removed)
        default:
            return nil
        }
    }

    private var editPreview: String? {
        guard normalizedName == "edit" else { return nil }
        let replacements = args["edits"]?.arrayValue?.compactMap(\.objectValue) ?? [args]
        let changes = replacements.compactMap { edit -> String? in
            guard let old = edit["oldText"]?.stringValue, let new = edit["newText"]?.stringValue else { return nil }
            let removed = old.isEmpty ? [] : old.components(separatedBy: "\n").map { "- " + $0 }
            let added = new.isEmpty ? [] : new.components(separatedBy: "\n").map { "+ " + $0 }
            return (removed + added).joined(separator: "\n")
        }.joined(separator: "\n")
        return changes.isEmpty ? nil : changes
    }

    private var actionVerb: String {
        if isRunning {
            switch normalizedName {
            case "bash", "shell": return "正在执行"
            case "read": return "正在分析"
            case "write": return "正在创建"
            case "edit": return "正在编辑"
            case "grep", "find", "ls": return "正在查找"
            default: return "正在运行"
            }
        }
        if isError {
            switch normalizedName {
            case "bash", "shell": return "执行失败"
            case "read": return "读取失败"
            case "write": return "写入失败"
            case "edit": return "编辑失败"
            default: return "调用失败"
            }
        }
        switch normalizedName {
        case "bash", "shell": return "已执行"
        case "read": return "已分析"
        case "write": return "已创建"
        case "edit": return "已编辑"
        case "grep", "find", "ls": return "已查找"
        default: return "已调用"
        }
    }

    private var commandSummary: String {
        if let desc = args["description"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !desc.isEmpty {
            return desc
        }
        if let cmd = command?.trimmingCharacters(in: .whitespacesAndNewlines), !cmd.isEmpty {
            let firstLine = cmd.components(separatedBy: .newlines).first ?? cmd
            return firstLine.count > 72 ? String(firstLine.prefix(72)) + "…" : firstLine
        }
        if let pattern = args["pattern"]?.stringValue {
            return pattern
        }
        if let query = args["query"]?.stringValue {
            return query
        }
        return toolName
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if isRunning {
                    ProgressView()
                        .controlSize(.mini)
                }

                Text(actionVerb)
                    .font(.system(size: 13.5))
                    .foregroundStyle(isError ? Color.red : Color.secondary)

                if let path, let fileName, ["read", "write", "edit"].contains(normalizedName) {
                    let (iconName, iconColor) = FileIconResolver.iconAndColor(forPath: path)
                    Button {
                        if let onOpenFile {
                            onOpenFile(path, lineRangeBounds?.start, lineRangeBounds?.end)
                        } else if path.hasPrefix("/") {
                            NSWorkspace.shared.open(URL(fileURLWithPath: path))
                        } else {
                            withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: iconName)
                                .font(.system(size: 12))
                                .foregroundStyle(iconColor)
                            Text(fileName)
                                .font(.system(size: 13.5, weight: .medium))
                                .foregroundStyle(.primary.opacity(0.85))
                            if let lineRangeSuffix {
                                Text(lineRangeSuffix)
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .help(path)

                    if let diffCounts {
                        HStack(spacing: 5) {
                            Text("+\(diffCounts.added)")
                                .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color(nsColor: .systemGreen))
                            Text("-\(diffCounts.removed)")
                                .font(.system(size: 12.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color(nsColor: .systemRed).opacity(0.85))
                        }
                        .padding(.leading, 4)
                    }

                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
                    } label: {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
                    } label: {
                        HStack(spacing: 5) {
                            Text(commandSummary)
                                .font(.system(size: 13.5))
                                .foregroundStyle(.primary.opacity(0.82))
                                .lineLimit(1)
                            Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.secondary.opacity(0.7))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }

                Spacer(minLength: 0)
            }
            .padding(.vertical, 1)

            if isExpanded {
                if let command {
                    BashExecutionCardView(
                        command: command,
                        output: execution?.output ?? "",
                        exitCode: nil,
                        isRunning: isRunning
                    )
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        if let editPreview {
                            CodeBlockView(language: "diff", code: editPreview)
                        } else if !args.isEmpty {
                            Text("参数")
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(JSONValue.object(args).prettyPrinted)
                                .font(.system(size: 13, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        if let output = execution?.output, !output.isEmpty {
                            Text("输出")
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(output)
                                .font(.system(size: 13, design: .monospaced))
                                .textSelection(.enabled)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color(nsColor: .textBackgroundColor))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
                    )
                }
            }
        }
    }
}

private struct BashExecutionCardView: View {
    let command: String
    let output: String
    let exitCode: Int?
    let isRunning: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("$ \(command)")
                    .font(.system(.callout, design: .monospaced).weight(.medium))
                    .textSelection(.enabled)
                Spacer()
                if isRunning {
                    ProgressView().controlSize(.small)
                } else if let exitCode {
                    Text("退出码 \(exitCode)")
                        .font(.caption)
                        .foregroundStyle(exitCode == 0 ? Color.secondary : Color.red)
                }
            }
            if !output.isEmpty {
                ScrollView(.horizontal) {
                    Text(output)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if !isRunning {
                Text("无输出")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .contextMenu {
            Button("复制命令") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(command, forType: .string)
            }
            if !output.isEmpty {
                Button("复制输出") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(output, forType: .string)
                }
            }
        }
    }
}

private struct SummaryNoteView: View {
    let title: String
    let bodyText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if !bodyText.isEmpty {
                Text(bodyText)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.08))
        )
    }
}

// MARK: - 原生 Markdown 与围栏代码块渲染

struct MarkdownContentView: View, Equatable {
    let markdown: String

    private enum Segment: Identifiable {
        case heading(id: Int, level: Int, text: String)
        case prose(id: Int, text: String)
        case code(id: Int, language: String, code: String)
        case table(id: Int, header: [String], rows: [[String]])

        var id: Int {
            switch self {
            case .heading(let id, _, _), .prose(let id, _), .code(let id, _, _), .table(let id, _, _): return id
            }
        }
    }

    private var segments: [Segment] {
        var result: [Segment] = []
        let lines = markdown.components(separatedBy: .newlines)
        var proseLines: [String] = []
        var codeLines: [String] = []
        var inCode = false
        var codeLang = ""
        var nextId = 0

        func appendProse(_ lines: ArraySlice<String>) {
            let joined = lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !joined.isEmpty {
                result.append(.prose(id: nextId, text: joined))
                nextId += 1
            }
        }

        func flushProse() {
            var start = 0
            var i = 0
            while i + 1 < proseLines.count {
                guard let header = tableCells(proseLines[i]), header.count > 1,
                      let separator = tableCells(proseLines[i + 1]), separator.count == header.count,
                      separator.allSatisfy({ cell in
                          let hyphens = cell.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
                          return !hyphens.isEmpty && hyphens.allSatisfy { $0 == "-" }
                      }) else {
                    i += 1
                    continue
                }
                appendProse(proseLines[start..<i])
                i += 2
                var rows: [[String]] = []
                while i < proseLines.count, let row = tableCells(proseLines[i]), row.count == header.count {
                    rows.append(row)
                    i += 1
                }
                result.append(.table(id: nextId, header: header, rows: rows))
                nextId += 1
                start = i
            }
            appendProse(proseLines[start...])
            proseLines.removeAll()
        }

        for line in lines {
            if line.hasPrefix("```") {
                if inCode {
                    result.append(.code(id: nextId, language: codeLang, code: codeLines.joined(separator: "\n")))
                    nextId += 1
                    codeLines.removeAll()
                    codeLang = ""
                    inCode = false
                } else {
                    flushProse()
                    inCode = true
                    codeLang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                }
            } else if inCode {
                codeLines.append(line)
            } else if let (level, title) = parseHeading(line) {
                flushProse()
                result.append(.heading(id: nextId, level: level, text: title))
                nextId += 1
            } else {
                proseLines.append(line)
            }
        }
        if inCode {
            result.append(.code(id: nextId, language: codeLang, code: codeLines.joined(separator: "\n")))
        } else {
            flushProse()
        }
        return result
    }

    private func tableCells(_ line: String) -> [String]? {
        guard line.contains("|") else { return nil }
        var text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|"), !text.hasSuffix("\\|") { text.removeLast() }
        var cells: [String] = []
        var cell = ""
        for character in text {
            if character == "|" {
                if cell.last == "\\" {
                    cell.removeLast()
                    cell.append(character)
                } else {
                    cells.append(cell.trimmingCharacters(in: .whitespaces))
                    cell = ""
                }
            } else {
                cell.append(character)
            }
        }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }

    private func parseHeading(_ line: String) -> (Int, String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let level = trimmed.prefix { $0 == "#" }.count
        guard (1...6).contains(level), trimmed.dropFirst(level).first?.isWhitespace == true else { return nil }
        let title = trimmed.dropFirst(level).trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? nil : (level, title)
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: 23
        case 2: 21
        case 3: 19
        default: 17
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(segments) { segment in
                switch segment {
                case .heading(_, let level, let text):
                    inlineMarkdownText(text)
                        .font(.system(size: headingSize(level), weight: .semibold))
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 8)
                        .textSelection(.enabled)
                case .prose(_, let text):
                    inlineMarkdownText(text)
                        .font(.system(size: 14.5))
                        .lineSpacing(7)
                        .textSelection(.enabled)
                case .code(_, let lang, let code):
                    CodeBlockView(language: lang, code: code)
                case .table(_, let header, let rows):
                    ScrollView(.horizontal) {
                        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                            tableRow(header, isHeader: true)
                            ForEach(rows.indices, id: \.self) { index in
                                tableRow(rows[index], alternate: index.isMultiple(of: 2))
                            }
                        }
                        .frame(minWidth: 280, alignment: .leading)
                    }
                    .background(Color(nsColor: .systemBlue).opacity(0.035), in: .rect(cornerRadius: 14))
                    .clipShape(.rect(cornerRadius: 14))
                }
            }
        }
        .tint(Color(nsColor: .systemBlue))
        .environment(\.openURL, OpenURLAction { url in
            switch url.scheme?.lowercased() {
            case "https", "http":
                return .systemAction
            case "file":
                guard url.host == nil || url.host == "" || url.host == "localhost",
                      url.path.hasPrefix("/"),
                      FileManager.default.fileExists(atPath: url.path) else {
                    return .discarded
                }
                NSWorkspace.shared.activateFileViewerSelecting([url])
                return .handled
            default:
                return .discarded
            }
        })
    }

    private func tableRow(_ cells: [String], isHeader: Bool = false, alternate: Bool = false) -> some View {
        GridRow {
            ForEach(cells.indices, id: \.self) { column in
                inlineMarkdownText(cells[column])
                    .font(.system(size: 13.5, weight: isHeader ? .semibold : .regular))
                    .textSelection(.enabled)
                    .frame(minWidth: 68, maxWidth: 260, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
            }
        }
        .background(Color(nsColor: .systemBlue).opacity(isHeader ? 0.15 : (alternate ? 0.045 : 0)))
    }

    private func inlineMarkdownText(_ text: String) -> Text {
        if var attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            let links = attributed.runs.compactMap { run in
                run.link == nil ? nil : run.range
            }
            for range in links {
                attributed[range].foregroundColor = Color(nsColor: .systemBlue)
            }
            return Text(attributed)
        }
        return Text(text)
    }
}

private struct CodeBlockView: View {
    let language: String
    let code: String
    @State private var copied = false

    private var languageTag: String {
        language.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
    }

    private var languageLabel: String {
        switch languageTag.lowercased() {
        case "bash": "Bash"
        case "zsh": "Zsh"
        case "sh", "shell": "Shell"
        case "console": "终端"
        case "diff", "patch": "代码改动"
        case "mermaid": "Mermaid 源码"
        case "": "代码"
        default: languageTag
        }
    }

    private var tint: Color {
        switch languageTag.lowercased() {
        case "bash", "zsh", "sh", "shell", "console": Color(nsColor: .systemTeal)
        default: Color(nsColor: .systemBlue)
        }
    }

    private var displayedCode: Text {
        guard ["diff", "patch"].contains(languageTag.lowercased()) else { return Text(code) }
        var styled = AttributedString()
        for (index, line) in code.components(separatedBy: "\n").enumerated() {
            if index > 0 { styled.append(AttributedString("\n")) }
            var part = AttributedString(line)
            if line.hasPrefix("+"), !line.hasPrefix("+++") {
                part.backgroundColor = Color(nsColor: .systemGreen).opacity(0.20)
            } else if line.hasPrefix("-"), !line.hasPrefix("---") {
                part.backgroundColor = Color(nsColor: .systemRed).opacity(0.20)
            } else if line.hasPrefix("@@") {
                part.foregroundColor = Color(nsColor: .systemBlue)
            }
            styled.append(part)
        }
        return Text(styled)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label(languageLabel, systemImage: "chevron.left.forwardslash.chevron.right")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(tint)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        copied = false
                    }
                } label: {
                    Label(copied ? "已复制" : "复制代码", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .labelStyle(.iconOnly)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help(copied ? "已复制" : "复制代码")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)

            ScrollView(.horizontal, showsIndicators: true) {
                displayedCode
                    .font(.system(size: 13.5, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(tint.opacity(0.055), in: .rect(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(tint.opacity(0.18), lineWidth: 1)
                .allowsHitTesting(false)
        )
    }
}
