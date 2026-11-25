import AppKit
import SwiftUI

struct MessageListView: View, Equatable {
    let messages: [AgentMessage]
    let toolExecutions: [String: ToolExecution]
    let runningBash: (command: String, output: String)?
    let optimisticUser: (text: String, images: [ImageAttachment])?
    let isStreaming: Bool

    @State private var lastScrollAt: Date = .distantPast

    nonisolated static func == (lhs: MessageListView, rhs: MessageListView) -> Bool {
        lhs.isStreaming == rhs.isStreaming
            && lhs.runningBash?.command == rhs.runningBash?.command
            && lhs.runningBash?.output == rhs.runningBash?.output
            && lhs.optimisticUser?.text == rhs.optimisticUser?.text
            && lhs.optimisticUser?.images == rhs.optimisticUser?.images
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
                                }
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

                    if let optimisticUser {
                        UserBubbleView(text: optimisticUser.text, images: optimisticUser.images)
                            .id("optimistic-user")
                    }

                    Color.clear
                        .frame(height: 150)
                        .id("bottom-anchor")
                }
                .frame(maxWidth: 740, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: messages.count) { _, _ in
                lastScrollAt = Date()
                withAnimation(.easeOut(duration: 0.14)) {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
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

                        if isProcessExpanded {
                            VStack(alignment: .leading, spacing: 10) {
                                ForEach(Array(turn.thinkingBlocks.enumerated()), id: \.offset) { _, thinking in
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("思考过程")
                                            .font(.callout.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                        Text(thinking)
                                            .font(.system(size: 14))
                                            .foregroundStyle(.secondary)
                                            .textSelection(.enabled)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .fill(Color.primary.opacity(0.035))
                                    )
                                }

                                ForEach(turn.toolCalls, id: \.id) { tc in
                                    ToolExecutionCardView(
                                        toolName: tc.name,
                                        args: tc.args,
                                        execution: toolExecutions[tc.id]
                                    )
                                }
                            }
                            .padding(.leading, 2)
                        }
                    }
                }

                // 2. 中间回答正文
                ForEach(Array(turn.textSegments.enumerated()), id: \.offset) { _, text in
                    MarkdownContentView(markdown: text).equatable()
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
                parts.append("已完成")
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
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color(nsColor: .controlBackgroundColor))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                        )
                }
            }
        }
    }
}

private struct ToolExecutionCardView: View {
    let toolName: String
    let args: [String: JSONValue]
    let execution: ToolExecution?
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    if execution?.isRunning == true {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: execution?.isError == true ? "xmark.circle.fill" : "checkmark.circle.fill")
                            .foregroundStyle(execution?.isError == true ? Color.red : Color.green)
                            .font(.caption)
                    }
                    Text(toolName)
                        .font(.system(size: 14, design: .monospaced).weight(.medium))
                    if let duration = execution?.durationMs {
                        Text(String(format: "%.1fs", duration / 1000))
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.primary.opacity(0.035))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    if !args.isEmpty {
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
                Text(output)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
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

        var id: Int {
            switch self {
            case .heading(let id, _, _), .prose(let id, _), .code(let id, _, _): return id
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

        func flushProse() {
            let joined = proseLines.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !joined.isEmpty {
                result.append(.prose(id: nextId, text: joined))
                nextId += 1
            }
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

    private func parseHeading(_ line: String) -> (Int, String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("### ") { return (3, String(trimmed.dropFirst(4))) }
        if trimmed.hasPrefix("## ") { return (2, String(trimmed.dropFirst(3))) }
        if trimmed.hasPrefix("# ") { return (1, String(trimmed.dropFirst(2))) }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(segments) { segment in
                switch segment {
                case .heading(_, let level, let text):
                    inlineMarkdownText(text)
                        .font(.system(size: level == 1 ? 20 : (level == 2 ? 17.5 : 16), weight: .semibold))
                        .padding(.top, 4)
                        .textSelection(.enabled)
                case .prose(_, let text):
                    inlineMarkdownText(text)
                        .font(.system(size: 15))
                        .lineSpacing(5)
                        .textSelection(.enabled)
                case .code(_, let lang, let code):
                    CodeBlockView(language: lang, code: code)
                }
            }
        }
    }

    private func inlineMarkdownText(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }
}

private struct CodeBlockView: View {
    let language: String
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
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
                    Label(copied ? "已复制" : "复制", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.primary.opacity(0.04))

            Divider()

            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(size: 13.5, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}
