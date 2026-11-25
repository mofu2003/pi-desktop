import AppKit
import SwiftUI

/// 原生彩色富文本 Markdown 渲染器：
/// 支持分级标题、Callout 提示框、有序/无序列表、表格、语法高亮代码块、
/// 行内代码高亮，以及带文件类型彩色图标的可点击 file:// 与 https:// 超链接。
struct RichMarkdownView: View, Equatable {
    nonisolated static func == (lhs: RichMarkdownView, rhs: RichMarkdownView) -> Bool {
        lhs.markdown == rhs.markdown
    }

    let markdown: String

    private enum Block: Identifiable {
        case heading(id: Int, level: Int, text: String)
        case callout(id: Int, kind: CalloutKind, body: String)
        case quote(id: Int, body: String)
        case listItem(id: Int, marker: String, isOrdered: Bool, text: String)
        case divider(id: Int)
        case table(id: Int, headers: [String], rows: [[String]])
        case code(id: Int, language: String, code: String)
        case paragraph(id: Int, text: String)

        var id: Int {
            switch self {
            case .heading(let id, _, _),
                 .callout(let id, _, _),
                 .quote(let id, _),
                 .listItem(let id, _, _, _),
                 .divider(let id),
                 .table(let id, _, _),
                 .code(let id, _, _),
                 .paragraph(let id, _):
                return id
            }
        }
    }

    private enum CalloutKind: String {
        case note = "NOTE"
        case tip = "TIP"
        case important = "IMPORTANT"
        case warning = "WARNING"
        case caution = "CAUTION"

        var title: String {
            switch self {
            case .note: return "说明"
            case .tip: return "提示"
            case .important: return "重要"
            case .warning: return "注意"
            case .caution: return "警告"
            }
        }

        var icon: String {
            switch self {
            case .note: return "info.circle.fill"
            case .tip: return "lightbulb.fill"
            case .important: return "exclamationmark.circle.fill"
            case .warning: return "exclamationmark.triangle.fill"
            case .caution: return "flame.fill"
            }
        }

        var color: Color {
            switch self {
            case .note: return .blue
            case .tip: return .green
            case .important: return .purple
            case .warning: return .orange
            case .caution: return .red
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parsedBlocks) { block in
                switch block {
                case .heading(_, let level, let text):
                    richInlineView(text, baseFont: .system(size: level == 1 ? 20 : (level == 2 ? 17.5 : 16), weight: .semibold))
                        .padding(.top, level == 1 ? 8 : 5)

                case .callout(_, let kind, let bodyText):
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(kind.color)
                            .frame(width: 3)
                        VStack(alignment: .leading, spacing: 4) {
                            Label(kind.title, systemImage: kind.icon)
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(kind.color)
                            richInlineView(bodyText, baseFont: .system(size: 14.5))
                                .lineSpacing(4)
                        }
                        .padding(.vertical, 2)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(kind.color.opacity(0.08))
                    )

                case .quote(_, let bodyText):
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Color.secondary.opacity(0.45))
                            .frame(width: 3)
                        richInlineView(bodyText, baseFont: .system(size: 14.5))
                            .foregroundStyle(.secondary)
                            .lineSpacing(4)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.primary.opacity(0.03))
                    )

                case .listItem(_, let marker, let isOrdered, let text):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if isOrdered {
                            Text(marker)
                                .font(.system(size: 14.5, weight: .semibold))
                                .foregroundStyle(Color.accentColor)
                                .monospacedDigit()
                                .frame(minWidth: 20, alignment: .trailing)
                        } else {
                            Circle()
                                .fill(Color.accentColor.opacity(0.85))
                                .frame(width: 5.5, height: 5.5)
                                .padding(.leading, 7)
                                .padding(.trailing, 3)
                                .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 3 }
                        }
                        richInlineView(text, baseFont: .system(size: 15))
                            .lineSpacing(5)
                    }
                    .padding(.leading, 4)

                case .divider:
                    Divider()
                        .padding(.vertical, 4)

                case .table(_, let headers, let rows):
                    MarkdownTableView(headers: headers, rows: rows) { cellText in
                        richInlineView(cellText, baseFont: .system(size: 13.5))
                    }

                case .code(_, let lang, let code):
                    SyntaxCodeBlockView(language: lang, code: code)

                case .paragraph(_, let text):
                    richInlineView(text, baseFont: .system(size: 15))
                        .lineSpacing(5)
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            if url.isFileURL {
                if FileManager.default.fileExists(atPath: url.path) {
                    NSWorkspace.shared.open(url)
                } else {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
                return .handled
            }
            if url.scheme == "http" || url.scheme == "https" {
                NSWorkspace.shared.open(url)
                return .handled
            }
            return .systemAction
        })
    }

    // MARK: - 块级解析

    private var parsedBlocks: [Block] {
        var result: [Block] = []
        let lines = markdown.components(separatedBy: .newlines)
        var proseLines: [String] = []
        var codeLines: [String] = []
        var inCode = false
        var codeLang = ""
        var nextId = 0
        var index = 0

        func flushProse() {
            let joined = proseLines.joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !joined.isEmpty {
                result.append(.paragraph(id: nextId, text: joined))
                nextId += 1
            }
            proseLines.removeAll()
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                if inCode {
                    result.append(.code(id: nextId, language: codeLang, code: codeLines.joined(separator: "\n")))
                    nextId += 1
                    codeLines.removeAll()
                    codeLang = ""
                    inCode = false
                } else {
                    flushProse()
                    inCode = true
                    codeLang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                }
                index += 1
                continue
            }

            if inCode {
                codeLines.append(line)
                index += 1
                continue
            }

            if trimmed == "---" || trimmed == "***" || trimmed == "___" {
                flushProse()
                result.append(.divider(id: nextId))
                nextId += 1
                index += 1
                continue
            }

            if let (level, title) = parseHeading(trimmed) {
                flushProse()
                result.append(.heading(id: nextId, level: level, text: title))
                nextId += 1
                index += 1
                continue
            }

            // 表格检测：当前行含 | 且下一行是 |---| 分隔行
            if trimmed.contains("|"),
               index + 1 < lines.count,
               isTableSeparator(lines[index + 1]) {
                flushProse()
                let headers = parseTableRow(trimmed)
                index += 2
                var rows: [[String]] = []
                while index < lines.count {
                    let rowLine = lines[index].trimmingCharacters(in: .whitespaces)
                    guard rowLine.contains("|"), !rowLine.isEmpty else { break }
                    rows.append(parseTableRow(rowLine))
                    index += 1
                }
                result.append(.table(id: nextId, headers: headers, rows: rows))
                nextId += 1
                continue
            }

            // Callout / Quote
            if trimmed.hasPrefix(">") {
                flushProse()
                var quoteLines: [String] = []
                while index < lines.count {
                    let qTrimmed = lines[index].trimmingCharacters(in: .whitespaces)
                    guard qTrimmed.hasPrefix(">") else { break }
                    let stripped = qTrimmed.dropFirst().trimmingCharacters(in: .whitespaces)
                    quoteLines.append(stripped)
                    index += 1
                }
                if let first = quoteLines.first,
                   let callout = parseCalloutKind(first) {
                    let rest = quoteLines.dropFirst().joined(separator: "\n")
                    result.append(.callout(id: nextId, kind: callout, body: rest))
                } else {
                    result.append(.quote(id: nextId, body: quoteLines.joined(separator: "\n")))
                }
                nextId += 1
                continue
            }

            // 列表项
            if let (marker, isOrdered, body) = parseListItem(trimmed) {
                flushProse()
                result.append(.listItem(id: nextId, marker: marker, isOrdered: isOrdered, text: body))
                nextId += 1
                index += 1
                continue
            }

            if trimmed.isEmpty {
                flushProse()
            } else {
                proseLines.append(line)
            }
            index += 1
        }

        if inCode {
            result.append(.code(id: nextId, language: codeLang, code: codeLines.joined(separator: "\n")))
        } else {
            flushProse()
        }
        return result
    }

    private func parseHeading(_ line: String) -> (Int, String)? {
        if line.hasPrefix("### ") { return (3, String(line.dropFirst(4))) }
        if line.hasPrefix("## ") { return (2, String(line.dropFirst(3))) }
        if line.hasPrefix("# ") { return (1, String(line.dropFirst(2))) }
        return nil
    }

    private func parseCalloutKind(_ firstLine: String) -> CalloutKind? {
        let upper = firstLine.trimmingCharacters(in: .whitespaces).uppercased()
        for kind in [CalloutKind.note, .tip, .important, .warning, .caution] {
            if upper == "[!\(kind.rawValue)]" { return kind }
        }
        return nil
    }

    private func parseListItem(_ line: String) -> (String, Bool, String)? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") {
            return ("•", false, String(line.dropFirst(2)))
        }
        if let dotRange = line.range(of: #"^\d+\.\s+"#, options: .regularExpression) {
            let marker = String(line[dotRange]).trimmingCharacters(in: .whitespaces)
            let body = String(line[dotRange.upperBound...])
            return (marker, true, body)
        }
        return nil
    }

    private func isTableSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|"), trimmed.contains("-") else { return false }
        let allowed = CharacterSet(charactersIn: "|-: ")
        return trimmed.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private func parseTableRow(_ line: String) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    // MARK: - 行内富文本（含文件彩色图标、可点击超链接、胶囊代码与多色样式）

    private func richInlineView(_ text: String, baseFont: Font) -> Text {
        // 先把显式 Markdown 链接 [label](url) 分段，以便在 file:// 与 https:// 链接前注入彩色图标
        let pattern = #"\[([^\]]+)\]\(([^)\s]+)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return Text(styledInlineAttributedString(text))
                .font(baseFont)
        }

        let nsText = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))
        if matches.isEmpty {
            return Text(styledInlineAttributedString(text))
                .font(baseFont)
        }

        var combined = Text("")
        var cursor = 0

        for match in matches {
            let fullRange = match.range
            if fullRange.location > cursor {
                let prefix = nsText.substring(with: NSRange(location: cursor, length: fullRange.location - cursor))
                combined = combined + Text(styledInlineAttributedString(prefix)).font(baseFont)
            }

            let label = nsText.substring(with: match.range(at: 1))
            let target = nsText.substring(with: match.range(at: 2))

            if let url = URL(string: target) {
                let (iconName, iconColor) = iconForLink(url: url, label: label)
                var linkAttr = AttributedString(label)
                linkAttr.link = url
                linkAttr.foregroundColor = .accentColor
                linkAttr.font = .system(size: 14.5, weight: .medium)

                combined = combined
                    + Text(Image(systemName: iconName))
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundColor(iconColor)
                    + Text(" ")
                    + Text(linkAttr)
            } else {
                combined = combined + Text(styledInlineAttributedString(label)).font(baseFont)
            }
            cursor = fullRange.location + fullRange.length
        }

        if cursor < nsText.length {
            let tail = nsText.substring(from: cursor)
            combined = combined + Text(styledInlineAttributedString(tail)).font(baseFont)
        }

        return combined.font(baseFont)
    }

    private func styledInlineAttributedString(_ raw: String) -> AttributedString {
        var attributed = (try? AttributedString(
            markdown: raw,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(raw)

        for run in attributed.runs {
            let range = run.range
            if let intent = run.inlinePresentationIntent, intent.contains(.code) {
                attributed[range].font = .system(size: 13.5, design: .monospaced)
                attributed[range].backgroundColor = Color.primary.opacity(0.075)
                attributed[range].foregroundColor = Color.primary
            }
            if run.link != nil {
                attributed[range].foregroundColor = .accentColor
                attributed[range].underlineStyle = .single
            }
        }
        return attributed
    }

    private func iconForLink(url: URL, label: String) -> (String, Color) {
        if url.isFileURL {
            return FileIconResolver.iconAndColor(forExtension: url.pathExtension)
        }
        return ("link", .accentColor)
    }
}

enum FileIconResolver {
    static func iconAndColor(forPath path: String) -> (String, Color) {
        let ext = (path as NSString).pathExtension
        return iconAndColor(forExtension: ext)
    }

    static func iconAndColor(forExtension ext: String) -> (String, Color) {
        switch ext.lowercased() {
        case "swift": return ("swift", .orange)
        case "ts", "tsx", "js", "jsx": return ("chevron.left.forwardslash.chevron.right", .blue)
        case "py": return ("chevron.left.forwardslash.chevron.right", .green)
        case "json", "yml", "yaml", "plist", "toml": return ("curlybraces", .purple)
        case "md", "txt": return ("doc.text.fill", .teal)
        case "png", "jpg", "jpeg", "svg", "gif", "webp": return ("photo", .pink)
        case "sh", "zsh", "bash": return ("terminal.fill", .secondary)
        case "": return ("folder.fill", .blue)
        default: return ("doc.fill", .orange)
        }
    }
}

// MARK: - 表格渲染

private struct MarkdownTableView<CellContent: View>: View {
    let headers: [String]
    let rows: [[String]]
    let renderCell: (String) -> CellContent

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                        renderCell(header)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.05))
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { rIdx, row in
                    GridRow {
                        ForEach(0..<max(headers.count, row.count), id: \.self) { cIdx in
                            let text = cIdx < row.count ? row[cIdx] : ""
                            renderCell(text)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if rIdx < rows.count - 1 {
                        Divider()
                    }
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
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}

// MARK: - 语法高亮代码块

struct SyntaxCodeBlockView: View {
    let language: String
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
                        .foregroundStyle(copied ? Color.accentColor : Color.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.primary.opacity(0.04))

            Divider()

            ScrollView(.horizontal, showsIndicators: true) {
                Text(SyntaxHighlighter.highlight(code))
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

enum SyntaxHighlighter {
    static func highlight(_ source: String) -> AttributedString {
        var result = AttributedString(source)

        let rules: [(pattern: String, color: Color)] = [
            // 类型名（PascalCase）
            (#"\b[A-Z][A-Za-z0-9_]*\b"#, Color(red: 0.12, green: 0.52, blue: 0.68)),
            // 数字
            (#"\b\d+(?:\.\d+)?\b"#, Color(red: 0.16, green: 0.44, blue: 0.86)),
            // 常见语言关键字
            (#"\b(?:import|export|from|struct|class|enum|protocol|extension|actor|func|def|fn|let|var|const|val|if|else|switch|case|default|for|while|in|return|guard|defer|try|catch|throw|throws|async|await|public|private|internal|fileprivate|static|final|override|mutating|nonisolated|some|any|true|false|nil|null|undefined|self|Self|super|type|interface|implements|extends|new|yield)\b"#,
             Color(red: 0.72, green: 0.22, blue: 0.58)),
            // 字符串字面量
            (#""(?:\\.|[^"\\])*""#, Color(red: 0.80, green: 0.30, blue: 0.16)),
            (#"'(?:\\.|[^'\\])*'"#, Color(red: 0.80, green: 0.30, blue: 0.16)),
            // 单行注释（放最后覆盖内部关键字/字符串）
            (#"//[^\n]*"#, Color(red: 0.42, green: 0.50, blue: 0.44)),
            (#"(?m)^\s*#[^\n]*"#, Color(red: 0.42, green: 0.50, blue: 0.44))
        ]

        let nsSource = source as NSString
        for rule in rules {
            guard let regex = try? NSRegularExpression(pattern: rule.pattern) else { continue }
            let matches = regex.matches(in: source, range: NSRange(location: 0, length: nsSource.length))
            for match in matches {
                guard let swiftRange = Range(match.range, in: source),
                      let attrStart = AttributedString.Index(swiftRange.lowerBound, within: result),
                      let attrEnd = AttributedString.Index(swiftRange.upperBound, within: result) else {
                    continue
                }
                result[attrStart..<attrEnd].foregroundColor = rule.color
            }
        }

        return result
    }
}
