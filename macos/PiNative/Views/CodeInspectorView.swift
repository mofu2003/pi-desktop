import AppKit
import Observation
import SwiftUI

struct CodeInspectorTab: Identifiable, Equatable {
    var id: String { path }
    let path: String
    var focusStartLine: Int?
    var focusEndLine: Int?
    var scrollTrigger: UUID = UUID()

    var fileName: String {
        let name = (path as NSString).lastPathComponent
        return name.isEmpty ? path : name
    }
}

@Observable
@MainActor
final class CodeInspectorStore {
    var isVisible = false
    var tabs: [CodeInspectorTab] = []
    var activePath: String?

    var activeTab: CodeInspectorTab? {
        guard let activePath else { return tabs.first }
        return tabs.first(where: { $0.path == activePath }) ?? tabs.first
    }

    func open(path: String, startLine: Int? = nil, endLine: Int? = nil) {
        let normalized = (path as NSString).standardizingPath
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: normalized, isDirectory: &isDir), !isDir.boolValue else {
            return
        }

        if let idx = tabs.firstIndex(where: { $0.path == normalized }) {
            tabs[idx].focusStartLine = startLine
            tabs[idx].focusEndLine = endLine
            tabs[idx].scrollTrigger = UUID()
        } else {
            tabs.append(
                CodeInspectorTab(
                    path: normalized,
                    focusStartLine: startLine,
                    focusEndLine: endLine
                )
            )
        }
        activePath = normalized
        isVisible = true
    }

    /// 尝试拦截 file:// 链接并在右侧面板打开，返回 true 表示已拦截处理
    func handleFileURL(_ url: URL) -> Bool {
        guard url.isFileURL else { return false }
        let filePath = url.path
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: filePath, isDirectory: &isDir), !isDir.boolValue else {
            return false
        }

        let (startLine, endLine) = Self.parseLineFragment(url.fragment)
        open(path: filePath, startLine: startLine, endLine: endLine)
        return true
    }

    func closeTab(_ path: String) {
        guard let idx = tabs.firstIndex(where: { $0.path == path }) else { return }
        tabs.remove(at: idx)
        if activePath == path {
            if tabs.isEmpty {
                activePath = nil
                isVisible = false
            } else {
                let nextIndex = min(idx, tabs.count - 1)
                activePath = tabs[nextIndex].path
            }
        }
    }

    func refreshActive() {
        guard let activePath, let idx = tabs.firstIndex(where: { $0.path == activePath }) else { return }
        tabs[idx].scrollTrigger = UUID()
    }

    private static func parseLineFragment(_ fragment: String?) -> (Int?, Int?) {
        guard let fragment, !fragment.isEmpty else { return (nil, nil) }
        // 支持 L123、L123-L145、L123-145
        let cleaned = fragment.uppercased().replacingOccurrences(of: "L", with: "")
        let parts = cleaned.split(separator: "-", maxSplits: 1).map(String.init)
        guard let start = parts.first.flatMap(Int.init), start > 0 else { return (nil, nil) }
        if parts.count == 2, let end = Int(parts[1]), end >= start {
            return (start, end)
        }
        return (start, start)
    }
}

struct CodeInspectorView: View {
    @Bindable var store: CodeInspectorStore
    let projectRootPath: String?

    @State private var loadedLines: [AttributedString] = []
    @State private var rawContent: String = ""
    @State private var loadError: String?
    @State private var copied = false

    private var activeTab: CodeInspectorTab? { store.activeTab }

    private var breadcrumbSegments: [String] {
        guard let path = activeTab?.path else { return [] }
        if let root = projectRootPath, !root.isEmpty {
            let stdRoot = (root as NSString).standardizingPath
            if path.hasPrefix(stdRoot + "/") {
                let rel = String(path.dropFirst(stdRoot.count + 1))
                let rootName = (stdRoot as NSString).lastPathComponent
                return ["项目", rootName] + rel.split(separator: "/").map(String.init)
            }
        }
        return path.split(separator: "/").suffix(5).map(String.init)
    }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Divider()

            if let tab = activeTab {
                breadcrumbBar(for: tab)
                Divider()
                codeContent(for: tab)
            } else {
                emptyPlaceholder
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: activeTab?.path) { _, _ in
            reloadFile()
        }
        .onChange(of: activeTab?.scrollTrigger) { _, _ in
            reloadFile()
        }
        .onAppear {
            reloadFile()
        }
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(store.tabs) { tab in
                        let isSelected = tab.path == activeTab?.path
                        let (iconName, iconColor) = FileIconResolver.iconAndColor(forPath: tab.path)
                        HStack(spacing: 6) {
                            Image(systemName: iconName)
                                .font(.system(size: 11.5))
                                .foregroundStyle(iconColor)
                            Text(tab.fileName)
                                .font(.system(size: 12.5, weight: isSelected ? .medium : .regular))
                                .foregroundStyle(isSelected ? .primary : .secondary)
                                .lineLimit(1)
                            Button {
                                store.closeTab(tab.path)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 9.5, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(3)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(isSelected ? Color.primary.opacity(0.07) : Color.clear)
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            store.activePath = tab.path
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
            }

            Spacer(minLength: 4)

            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    store.isVisible = false
                }
            } label: {
                Image(systemName: "sidebar.right")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("收起代码面板")
            .padding(.trailing, 8)
        }
        .frame(height: 36)
        .background(Color.primary.opacity(0.02))
    }

    private func breadcrumbBar(for tab: CodeInspectorTab) -> some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    ForEach(Array(breadcrumbSegments.enumerated()), id: \.offset) { index, segment in
                        if index > 0 {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9))
                                .foregroundStyle(.tertiary)
                        }
                        if index == breadcrumbSegments.count - 1 {
                            let (iconName, iconColor) = FileIconResolver.iconAndColor(forPath: tab.path)
                            HStack(spacing: 4) {
                                Image(systemName: iconName)
                                    .font(.system(size: 11))
                                    .foregroundStyle(iconColor)
                                Text(segment)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(.primary)
                            }
                        } else {
                            Text(segment)
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Spacer(minLength: 8)

            HStack(spacing: 10) {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(rawContent, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.4))
                        copied = false
                    }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12))
                        .foregroundStyle(copied ? Color.accentColor : Color.secondary)
                }
                .buttonStyle(.plain)
                .help("复制文件内容")

                Button {
                    store.refreshActive()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("重新加载文件")

                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: tab.path))
                } label: {
                    Image(systemName: "arrow.up.forward.square")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("在外部编辑器中打开")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Color.primary.opacity(0.015))
    }

    @ViewBuilder
    private func codeContent(for tab: CodeInspectorTab) -> some View {
        if let loadError {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text(loadError)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView([.vertical, .horizontal], showsIndicators: true) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(loadedLines.enumerated()), id: \.offset) { index, lineText in
                            let lineNumber = index + 1
                            let isHighlighted = isLineHighlighted(lineNumber, tab: tab)
                            HStack(alignment: .top, spacing: 14) {
                                Text("\(lineNumber)")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(isHighlighted ? Color.accentColor : Color.secondary.opacity(0.65))
                                    .frame(minWidth: 38, alignment: .trailing)
                                    .monospacedDigit()

                                Text(lineText)
                                    .font(.system(size: 12.5, design: .monospaced))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 1.5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                isHighlighted
                                    ? Color.yellow.opacity(0.16)
                                    : Color.clear
                            )
                            .id(lineNumber)
                        }
                    }
                    .padding(.vertical, 10)
                }
                .onChange(of: tab.scrollTrigger) { _, _ in
                    scrollToTarget(tab: tab, proxy: proxy)
                }
                .onAppear {
                    scrollToTarget(tab: tab, proxy: proxy)
                }
            }
        }
    }

    private var emptyPlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("点击对话或工具流中的文件名即可在此查看源码")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func isLineHighlighted(_ line: Int, tab: CodeInspectorTab) -> Bool {
        guard let start = tab.focusStartLine else { return false }
        let end = tab.focusEndLine ?? start
        return line >= start && line <= end
    }

    private func scrollToTarget(tab: CodeInspectorTab, proxy: ScrollViewProxy) {
        guard let target = tab.focusStartLine, target > 0, target <= loadedLines.count else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            withAnimation(.easeInOut(duration: 0.2)) {
                proxy.scrollTo(target, anchor: .center)
            }
        }
    }

    private func reloadFile() {
        guard let path = activeTab?.path else {
            loadedLines = []
            rawContent = ""
            loadError = nil
            return
        }
        do {
            let text = try String(contentsOfFile: path, encoding: .utf8)
            rawContent = text
            loadError = nil
            // 按行保留高亮，超过 4000 行大文件分块/避免超长卡顿
            let lines = text.components(separatedBy: "\n")
            if lines.count <= 2500 {
                loadedLines = lines.map { SyntaxHighlighter.highlight($0.isEmpty ? " " : $0) }
            } else {
                loadedLines = lines.prefix(2500).map { AttributedString($0.isEmpty ? " " : $0) }
                    + [AttributedString("... 文件较大（共 \(lines.count) 行），已显示前 2500 行 ...")]
            }
        } catch {
            loadedLines = []
            rawContent = ""
            loadError = "无法读取文件：\(error.localizedDescription)"
        }
    }
}
