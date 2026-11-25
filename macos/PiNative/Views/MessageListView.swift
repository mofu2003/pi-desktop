import AppKit
import SwiftUI

struct MessageListView: View {
    let messages: [AgentMessage]
    let toolExecutions: [String: ToolExecution]
    let runningBash: (command: String, output: String)?
    let optimisticUser: (text: String, images: [ImageAttachment])?
    let isStreaming: Bool

    @State private var lastScrollAt: Date = .distantPast

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(messages) { message in
                        let isLastAssistant = isStreaming && message.id == messages.last(where: { $0.role == "assistant" })?.id
                        MessageRowView(
                            message: message,
                            toolExecutions: toolExecutions,
                            isStreamingMessage: isLastAssistant
                        )
                        .equatable()
                        .id(message.id)
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
                        .frame(height: 1)
                        .id("bottom-anchor")
                }
                .frame(maxWidth: 740, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
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
}

private struct MessageRowView: View, Equatable {
    nonisolated static func == (lhs: MessageRowView, rhs: MessageRowView) -> Bool {
        lhs.message == rhs.message
            && lhs.isStreamingMessage == rhs.isStreamingMessage
            && lhs.toolExecutions == rhs.toolExecutions
    }

    let message: AgentMessage
    let toolExecutions: [String: ToolExecution]
    let isStreamingMessage: Bool

    var body: some View {
        switch message.role {
        case "user":
            let images: [ImageAttachment] = message.content?.blocks.compactMap {
                if case .image(let data, let mime) = $0 { return ImageAttachment(data: data, mimeType: mime) }
                return nil
            } ?? []
            UserBubbleView(text: message.content?.plainText ?? "", images: images)

        case "assistant":
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array((message.content?.blocks ?? []).enumerated()), id: \.offset) { _, block in
                    switch block {
                    case .thinking(let text, let redacted):
                        ThinkingBlockView(
                            text: redacted ? "（思考内容已脱敏）" : text,
                            isStreaming: isStreamingMessage
                        )
                    case .text(let text):
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            MarkdownContentView(markdown: text)
                        }
                    case .toolCall(let id, let name, let args):
                        let exec = toolExecutions[id]
                        ToolExecutionCardView(
                            toolName: name,
                            args: args,
                            execution: exec
                        )
                    case .image(let data, _):
                        if let raw = Data(base64Encoded: data), let img = NSImage(data: raw) {
                            Image(nsImage: img)
                                .resizable()
                                .scaledToFit()
                                .frame(maxHeight: 280)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
                if let err = message.errorMessage, !err.isEmpty {
                    Text(err)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

        case "bashExecution":
            BashExecutionCardView(
                command: message.command ?? "",
                output: message.output ?? "",
                exitCode: message.exitCode,
                isRunning: false
            )

        case "compactionSummary":
            SummaryNoteView(title: "上下文已压缩", bodyText: message.summary ?? "")

        case "branchSummary":
            SummaryNoteView(title: "分支摘要", bodyText: message.summary ?? "")

        case "custom", "system":
            if message.display != false {
                SummaryNoteView(
                    title: message.role == "system" ? "系统提示" : (message.customType ?? "扩展消息"),
                    bodyText: message.content?.plainText ?? ""
                )
            }

        default:
            EmptyView()
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
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
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

private struct ThinkingBlockView: View {
    let text: String
    let isStreaming: Bool
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(isStreaming ? "正在思考…" : "思考过程")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.primary.opacity(0.03))
                    )
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
                        .font(.system(.callout, design: .monospaced).weight(.medium))
                    if let duration = execution?.durationMs {
                        Text(String(format: "%.1fs", duration / 1000))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
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
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(JSONValue.object(args).prettyPrinted)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    if let output = execution?.output, !output.isEmpty {
                        Text("输出")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(output)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
                .padding(10)
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
        VStack(alignment: .leading, spacing: 6) {
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
        .padding(10)
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
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.08))
        )
    }
}

// MARK: - 原生 Markdown 与围栏代码块渲染

struct MarkdownContentView: View {
    let markdown: String

    private enum Segment: Identifiable {
        case prose(id: Int, text: String)
        case code(id: Int, language: String, code: String)

        var id: Int {
            switch self {
            case .prose(let id, _), .code(let id, _, _): return id
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(segments) { segment in
                switch segment {
                case .prose(_, let text):
                    if let attributed = try? AttributedString(
                        markdown: text,
                        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                    ) {
                        Text(attributed)
                            .font(.body)
                            .lineSpacing(3)
                            .textSelection(.enabled)
                    } else {
                        Text(text)
                            .font(.body)
                            .lineSpacing(3)
                            .textSelection(.enabled)
                    }
                case .code(_, let lang, let code):
                    CodeBlockView(language: lang, code: code)
                }
            }
        }
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
                    .font(.caption.monospaced())
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
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.primary.opacity(0.04))

            Divider()

            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}
