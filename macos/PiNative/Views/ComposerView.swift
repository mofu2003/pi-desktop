import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ComposerView: View {
    @Bindable var sessionStore: PiSessionStore
    @Bindable var libraryStore: LibraryStore
    let activeProject: ProjectInfo?
    let canChooseProject: Bool
    @Binding var draft: String
    @Binding var attachments: [ImageAttachment]

    let onCreateProject: () -> Void
    let onSubmit: (String, [ImageAttachment]) -> Void

    @State private var isSettingsOpen = false
    @State private var isModelOpen = false
    @State private var modelQuery = ""
    @State private var openMetric: MetricId?
    @State private var isCompacting = false
    @State private var selectedSlashIndex = 0

    private enum MetricId: String {
        case session, tokens, context
    }

    private struct SlashCommandItem: Identifiable {
        let id: String
        let description: String
        let sourceLabel: String
        let group: String
    }

    private static let builtinCommands: [SlashCommandItem] = [
        .init(id: "compact", description: "压缩当前会话上下文，保留关键摘要", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "new", description: "开始一个新会话", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "name", description: "设置会话名称（/name 名称）", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "fork", description: "从历史用户消息分叉为新会话", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "clone", description: "克隆当前分支到新会话", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "copy", description: "复制最后一条助手回复", sourceLabel: "内置", group: "常用会话指令"),
        .init(id: "export", description: "导出当前会话为 HTML", sourceLabel: "内置", group: "常用会话指令")
    ]

    private var slashQuery: String? {
        guard draft.hasPrefix("/") else { return nil }
        let body = String(draft.dropFirst())
        if body.contains(where: { $0.isWhitespace || $0.isNewline }) { return nil }
        return body.lowercased()
    }

    private var allSlashCommands: [SlashCommandItem] {
        var seen = Set<String>()
        var result: [SlashCommandItem] = []
        for item in Self.builtinCommands where seen.insert(item.id).inserted {
            result.append(item)
        }
        for cmd in sessionStore.commands where seen.insert(cmd.name).inserted {
            let sourceLabel: String
            let group: String
            switch cmd.source {
            case "extension":
                sourceLabel = "扩展"
                group = "扩展指令"
            case "prompt":
                sourceLabel = "提示词"
                group = "提示词模板"
            case "skill":
                sourceLabel = "技能"
                group = "Agent 技能"
            default:
                sourceLabel = cmd.source
                group = "其他指令"
            }
            result.append(SlashCommandItem(
                id: cmd.name,
                description: cmd.description ?? "",
                sourceLabel: sourceLabel,
                group: group
            ))
        }
        return result
    }

    private var filteredSlashCommands: [SlashCommandItem] {
        guard let query = slashQuery else { return [] }
        if query.isEmpty { return allSlashCommands }
        return allSlashCommands.filter {
            $0.id.lowercased().contains(query)
            || $0.description.lowercased().contains(query)
            || $0.sourceLabel.lowercased().contains(query)
        }
    }

    private var activeRun: Bool {
        sessionStore.isStreaming || sessionStore.isBashRunning
    }

    private var isDisabled: Bool {
        sessionStore.isConnecting || sessionStore.state == nil
    }

    private var canSend: Bool {
        !isDisabled && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    var body: some View {
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                if canChooseProject {
                    HostAndProjectPickerBar(
                        activeProject: activeProject,
                        projects: libraryStore.projects,
                        libraryStore: libraryStore,
                        isDisabled: sessionStore.isConnecting,
                        onSelectTarget: { target in
                            Task { _ = await sessionStore.newSession(targetProject: target) }
                        },
                        onCreateProject: onCreateProject
                    )
                }

                composerCard
                    .overlay(alignment: .topLeading) {
                        if !filteredSlashCommands.isEmpty {
                            slashMenuOverlay
                                .alignmentGuide(.top) { d in d[.bottom] + 8 }
                                .zIndex(20)
                        }
                    }
            }

            metricsBar
        }
        .frame(maxWidth: 740)
        .frame(maxWidth: .infinity)
    }

    // MARK: - 斜杠命令浮层（macOS Spotlight 风格）

    private var slashMenuOverlay: some View {
        let grouped = Dictionary(grouping: filteredSlashCommands, by: \.group)
        let groupOrder = ["常用会话指令", "扩展指令", "提示词模板", "Agent 技能", "其他指令"]
            .filter { grouped[$0] != nil }

        return ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(groupOrder.enumerated()), id: \.element) { gIdx, groupName in
                    if gIdx > 0 {
                        Divider().padding(.vertical, 3)
                    }
                    Text(groupName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)
                        .padding(.top, 4)
                        .padding(.bottom, 2)

                    ForEach(grouped[groupName] ?? []) { item in
                        let flatIdx = filteredSlashCommands.firstIndex(where: { $0.id == item.id }) ?? 0
                        let isSelected = flatIdx == selectedSlashIndex

                        Button {
                            draft = "/\(item.id) "
                        } label: {
                            HStack(spacing: 12) {
                                Text("/\(item.id)")
                                    .font(.system(.callout, design: .monospaced).weight(.semibold))
                                    .foregroundStyle(isSelected ? Color.white : Color.primary)
                                Text(item.description)
                                    .font(.callout)
                                    .foregroundStyle(isSelected ? Color.white.opacity(0.92) : Color.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer(minLength: 8)
                                Text(item.sourceLabel)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(
                                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                                            .fill(isSelected ? Color.white.opacity(0.22) : Color.secondary.opacity(0.12))
                                    )
                                    .foregroundStyle(isSelected ? Color.white : Color.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(isSelected ? Color.accentColor : Color.clear)
                            )
                        }
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            if hovering { selectedSlashIndex = flatIdx }
                        }
                    }
                }
            }
            .padding(6)
        }
        .frame(maxWidth: 520, maxHeight: 280)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.14), radius: 14, y: 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - 主输入卡片

    private var composerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(attachments.enumerated()), id: \.element.id) { index, img in
                            ZStack(alignment: .topTrailing) {
                                if let raw = Data(base64Encoded: img.data), let nsImg = NSImage(data: raw) {
                                    Image(nsImage: nsImg)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 48, height: 48)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                                Button {
                                    attachments.remove(at: index)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.caption)
                                        .foregroundStyle(.white, .black.opacity(0.65))
                                }
                                .buttonStyle(.plain)
                                .offset(x: 4, y: -4)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                }
            }

            TextEditor(text: $draft)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 42, maxHeight: 150)
                .padding(.horizontal, 8)
                .padding(.top, attachments.isEmpty ? 8 : 0)
                .overlay(alignment: .topLeading) {
                    if draft.isEmpty {
                        Text(sessionStore.state != nil ? "给 Pi 发消息，/ 查看命令，! 执行命令…" : "正在连接 Pi…")
                            .font(.body)
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 13)
                            .padding(.top, attachments.isEmpty ? 8 : 0)
                            .allowsHitTesting(false)
                    }
                }
                .onKeyPress(.upArrow) {
                    guard !filteredSlashCommands.isEmpty else { return .ignored }
                    selectedSlashIndex = selectedSlashIndex > 0 ? selectedSlashIndex - 1 : filteredSlashCommands.count - 1
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    guard !filteredSlashCommands.isEmpty else { return .ignored }
                    selectedSlashIndex = selectedSlashIndex < filteredSlashCommands.count - 1 ? selectedSlashIndex + 1 : 0
                    return .handled
                }
                .onKeyPress(.tab) {
                    guard !filteredSlashCommands.isEmpty,
                          filteredSlashCommands.indices.contains(selectedSlashIndex) else { return .ignored }
                    draft = "/\(filteredSlashCommands[selectedSlashIndex].id) "
                    return .handled
                }
                .onKeyPress(.return) {
                    if !filteredSlashCommands.isEmpty,
                       filteredSlashCommands.indices.contains(selectedSlashIndex) {
                        draft = "/\(filteredSlashCommands[selectedSlashIndex].id) "
                        return .handled
                    }
                    if NSEvent.modifierFlags.contains(.shift) {
                        return .ignored
                    }
                    if canSend {
                        onSubmit(draft, attachments)
                        return .handled
                    }
                    return .ignored
                }

            HStack(spacing: 8) {
                Button(action: pickImages) {
                    Image(systemName: "photo")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("添加图片")
                .disabled(isDisabled)

                Button {
                    isSettingsOpen.toggle()
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("会话运行选项")
                .disabled(isDisabled)
                .popover(isPresented: $isSettingsOpen, arrowEdge: .top) {
                    runOptionsPopover
                }

                let queuedCount = sessionStore.queuedMessages.steering.count + sessionStore.queuedMessages.followUp.count
                if queuedCount > 0 {
                    Button("清空队列 (\(queuedCount))") {
                        Task { await sessionStore.clearQueue() }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                }

                if sessionStore.isRetrying {
                    Button("取消重试") {
                        Task { await sessionStore.abortRetry() }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                }

                Spacer()

                Button {
                    isModelOpen.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Text(sessionStore.state?.model?.displayName ?? "选择模型")
                            .font(.callout)
                        if let level = sessionStore.state?.thinkingLevel, level != .off {
                            Text(level.displayName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .disabled(sessionStore.isConnecting || activeRun)
                .popover(isPresented: $isModelOpen, arrowEdge: .top) {
                    modelAndThinkingPopover
                }

                if activeRun {
                    Button {
                        Task { await sessionStore.stop() }
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.title2)
                            .foregroundStyle(.primary)
                    }
                    .buttonStyle(.plain)
                    .help("停止生成")
                } else {
                    Button {
                        onSubmit(draft, attachments)
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundStyle(canSend ? Color.accentColor : Color.secondary.opacity(0.4))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .help("发送消息")
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.05), radius: 10, y: 3)
    }

    // MARK: - 会话运行选项 Popover（不含自动压缩）

    private var runOptionsPopover: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("会话运行选项")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("流式发送行为")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("流式发送行为", selection: Binding(
                    get: { sessionStore.streamingBehavior },
                    set: { sessionStore.streamingBehavior = $0 }
                )) {
                    Text("引导插队").tag("steer")
                    Text("结束后追问").tag("followUp")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            if let state = sessionStore.state {
                VStack(alignment: .leading, spacing: 4) {
                    Text("引导队列投递")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("引导队列投递", selection: Binding(
                        get: { state.steeringMode },
                        set: { mode in Task { await sessionStore.setSteeringMode(mode) } }
                    )) {
                        Text("逐条").tag("one-at-a-time")
                        Text("全部").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("追问队列投递")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("追问队列投递", selection: Binding(
                        get: { state.followUpMode },
                        set: { mode in Task { await sessionStore.setFollowUpMode(mode) } }
                    )) {
                        Text("逐条").tag("one-at-a-time")
                        Text("全部").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
            }

            Toggle("失败后自动重试", isOn: Binding(
                get: { sessionStore.autoRetryEnabled },
                set: { enabled in Task { await sessionStore.setAutoRetry(enabled) } }
            ))
            .toggleStyle(.switch)
        }
        .padding(16)
        .frame(width: 260)
    }

    // MARK: - 模型与思考档位 Popover

    private var modelAndThinkingPopover: some View {
        let levels = MetricsCalculator.supportedThinkingLevels(
            model: sessionStore.state?.model,
            runtimeLevels: sessionStore.state?.availableThinkingLevels
        )
        let currentLevel = sessionStore.state?.thinkingLevel ?? .off
        let currentIdx = Double(levels.firstIndex(of: currentLevel) ?? 0)
        let filteredModels = modelQuery.trimmingCharacters(in: .whitespaces).isEmpty
            ? sessionStore.models
            : sessionStore.models.filter {
                $0.displayName.localizedCaseInsensitiveContains(modelQuery)
                || $0.provider.localizedCaseInsensitiveContains(modelQuery)
            }

        return VStack(alignment: .leading, spacing: 12) {
            TextField("搜索模型…", text: $modelQuery)
                .textFieldStyle(.roundedBorder)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(filteredModels) { model in
                        let isCurrent = model.id == sessionStore.state?.model?.id
                            && model.provider == sessionStore.state?.model?.provider
                        Button {
                            Task { await sessionStore.setModel(provider: model.provider, modelId: model.id) }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(model.displayName)
                                        .font(.callout)
                                    Text(model.provider)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if isCurrent {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 180)

            if levels.count > 1 {
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("思考档位")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(currentLevel.displayName)
                            .font(.caption.weight(.medium))
                    }
                    Slider(
                        value: Binding(
                            get: { currentIdx },
                            set: { newVal in
                                let snapped = Int(newVal.rounded())
                                if levels.indices.contains(snapped), levels[snapped] != currentLevel {
                                    Task { await sessionStore.setThinkingLevel(levels[snapped]) }
                                }
                            }
                        ),
                        in: 0...Double(levels.count - 1),
                        step: 1
                    )
                }
            }
        }
        .padding(14)
        .frame(width: 280)
    }

    // MARK: - 精确指标栏（含上下文占用页与自动压缩开关）

    private var metricsBar: some View {
        let timing = MetricsCalculator.summarizeTimings(messages: sessionStore.messages)
        let stats = sessionStore.stats
        let rounds = stats?.userMessages
        let steps = stats.map { $0.assistantMessages + $0.toolCalls }
        let speedText = timing.tokensPerSecond.map { String(format: "%.1f tok/s", $0) } ?? "—"
        let hitRate = MetricsCalculator.cacheHitPercent(stats?.tokens)
        let used = MetricsCalculator.nonnegative(stats?.contextUsage?.tokens)
        let limit = MetricsCalculator.nonnegative(stats?.contextUsage?.contextWindow)
            ?? MetricsCalculator.nonnegative(sessionStore.state?.model?.contextWindow)
        let remaining = (used != nil && limit != nil) ? max(0, limit! - used!) : nil
        let percent: Double? = MetricsCalculator.nonnegative(stats?.contextUsage?.percent)
            ?? ((used != nil && limit != nil && limit! > 0) ? Double(used!) / Double(limit!) * 100.0 : nil)
        let progress = min(100, percent ?? 0)

        return HStack(spacing: 14) {
            Button {
                openMetric = openMetric == .session ? nil : .session
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                    Text(rounds == nil ? "会话统计 · —" : "\(rounds!) 轮 · \(steps!) 步\(timing.tokensPerSecond == nil ? "" : " · \(speedText)")")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            }
            .buttonStyle(.plain)
            .popover(isPresented: Binding(
                get: { openMetric == .session },
                set: { if !$0 { openMetric = nil } }
            ), arrowEdge: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("会话统计").font(.headline)
                    metricRow("对话轮数", rounds.map(String.init) ?? "—")
                    metricRow("模型回复", stats.map { String($0.assistantMessages) } ?? "—")
                    metricRow("工具调用", stats.map { String($0.toolCalls) } ?? "—")
                    metricRow("模型用时", formatDuration(timing.modelMs))
                    metricRow("工具用时", formatDuration(timing.toolMs))
                    metricRow("输出速率", speedText)
                }
                .padding(14)
                .frame(width: 230)
            }

            Button {
                openMetric = openMetric == .tokens ? nil : .tokens
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "cylinder.split.1x2")
                    Text(stats.map { "\($0.tokens.total.formatted()) tok · 缓存 \(formatPercent(hitRate))" } ?? "Token 用量 · —")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            }
            .buttonStyle(.plain)
            .popover(isPresented: Binding(
                get: { openMetric == .tokens },
                set: { if !$0 { openMetric = nil } }
            ), arrowEdge: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Token 用量").font(.headline)
                    metricRow("累计 Token", stats.map { $0.tokens.total.formatted() } ?? "—")
                    metricRow("缓存命中", formatPercent(hitRate))
                    metricRow("未缓存输入", stats.map { $0.tokens.input.formatted() } ?? "—")
                    metricRow("缓存读取", stats.map { $0.tokens.cacheRead.formatted() } ?? "—")
                    metricRow("缓存写入", stats.map { $0.tokens.cacheWrite.formatted() } ?? "—")
                    metricRow("输出", stats.map { $0.tokens.output.formatted() } ?? "—")
                    metricRow("累计费用", stats.map { String(format: "$%.4f", $0.cost) } ?? "—")
                }
                .padding(14)
                .frame(width: 240)
            }

            Button {
                openMetric = openMetric == .context ? nil : .context
            } label: {
                HStack(spacing: 5) {
                    ContextRingView(progress: progress / 100.0)
                    Text("上下文 \(formatPercent(percent))")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            }
            .buttonStyle(.plain)
            .popover(isPresented: Binding(
                get: { openMetric == .context },
                set: { if !$0 { openMetric = nil } }
            ), arrowEdge: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("上下文占用").font(.headline)
                    metricRow("已用比例", formatPercent(percent))
                    if percent != nil {
                        ProgressView(value: progress, total: 100)
                    }
                    metricRow("已用", used.map { "\($0.formatted()) tok" } ?? "—")
                    metricRow("剩余", remaining.map { "\($0.formatted()) tok" } ?? "—")
                    metricRow("窗口上限", limit.map { "\($0.formatted()) tok" } ?? "—")

                    if let state = sessionStore.state {
                        Divider()
                        Toggle("自动压缩上下文", isOn: Binding(
                            get: { state.autoCompactionEnabled },
                            set: { checked in Task { await sessionStore.setAutoCompaction(checked) } }
                        ))
                        .toggleStyle(.switch)

                        Text("接近上下文上限时自动提炼摘要，释放可用窗口")
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        Button(isCompacting ? "正在压缩上下文…" : "立即压缩上下文") {
                            guard !isCompacting else { return }
                            isCompacting = true
                            Task {
                                _ = await sessionStore.compact()
                                isCompacting = false
                            }
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                        .disabled(sessionStore.isStreaming || isCompacting || sessionStore.messages.isEmpty)
                    }
                }
                .padding(16)
                .frame(width: 270)
            }
        }
    }

    private func metricRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
                .monospacedDigit()
        }
    }

    private func formatPercent(_ val: Double?) -> String {
        guard let val else { return "—" }
        return String(format: "%.1f%%", val)
    }

    private func formatDuration(_ ms: Double?) -> String {
        guard let ms else { return "—" }
        let sec = ms / 1000.0
        if sec < 60 { return String(format: "%.1f 秒", sec) }
        return "\(Int(sec) / 60) 分 \(Int(sec) % 60) 秒"
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.title = "选择图片附件"
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            guard let data = try? Data(contentsOf: url), data.count <= 10 * 1024 * 1024 else { continue }
            let ext = url.pathExtension.lowercased()
            let mime = switch ext {
            case "jpg", "jpeg": "image/jpeg"
            case "gif": "image/gif"
            case "webp": "image/webp"
            default: "image/png"
            }
            attachments.append(ImageAttachment(data: data.base64EncodedString(), mimeType: mime))
        }
    }
}

private struct ContextRingView: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.primary.opacity(0.18), lineWidth: 2)
            Circle()
                .trim(from: 0, to: max(0, min(1, progress)))
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 12, height: 12)
    }
}

// MARK: - 此电脑 / SSH 主机 + 关联项目选择器（Antigravity 同款体验）

private struct HostAndProjectPickerBar: View {
    let activeProject: ProjectInfo?
    let projects: [ProjectInfo]
    @Bindable var libraryStore: LibraryStore
    let isDisabled: Bool
    let onSelectTarget: (ProjectInfo?) -> Void
    let onCreateProject: () -> Void

    @State private var isHostOpen = false
    @State private var isSshPanelOpen = false
    @State private var configHosts: [SshHostInfo] = []
    @State private var sshQuery = ""
    @State private var isConnectingSshDialog = false
    @State private var sshHostInput = ""
    @State private var sshCwdInput = "~"
    @State private var sshInputError: String?
    @State private var isCwdDialogOpen = false
    @State private var remoteCwdDraft = "~"

    private var activeSsh: SshTarget? { activeProject?.ssh }

    private var mergedHosts: [SshHostInfo] {
        var map: [String: SshHostInfo] = [:]
        var order: [String] = []
        for host in configHosts {
            order.append(host.name)
            map[host.name] = host
        }
        for host in libraryStore.customSshHosts where map[host.name] == nil {
            order.append(host.name)
            map[host.name] = host
        }
        let all = order.compactMap { map[$0] }
        let q = sshQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return all }
        return all.filter {
            $0.name.lowercased().contains(q)
            || ($0.hostName?.lowercased().contains(q) ?? false)
            || ($0.user?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Button {
                sshQuery = ""
                isSshPanelOpen = activeSsh != nil
                isHostOpen.toggle()
                if isHostOpen {
                    Task.detached(priority: .userInitiated) {
                        let loaded = SshConfigService.listHosts()
                        await MainActor.run {
                            configHosts = loaded
                        }
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: activeSsh != nil ? "terminal" : "desktopcomputer")
                    Text(activeSsh?.displayLabel ?? "此电脑")
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    Capsule()
                        .fill(activeSsh != nil ? Color.primary.opacity(0.09) : Color.clear)
                )
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)
            .popover(isPresented: $isHostOpen, arrowEdge: .top) {
                hostPopoverBody
            }

            if let activeSsh {
                let currentCwd = activeSsh.remoteCwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "~"
                let cwds = Array(Set(["~", currentCwd] + (libraryStore.sshRemoteCwds[activeSsh.host] ?? []))).sorted()
                Menu {
                    ForEach(cwds, id: \.self) { dir in
                        Button {
                            libraryStore.recordRemoteCwd(host: activeSsh.host, cwd: dir)
                            onSelectTarget(ProjectInfo(
                                path: dir,
                                name: dir == "~" ? activeSsh.displayLabel : "\(activeSsh.displayLabel):\(dir)",
                                ssh: SshTarget(host: activeSsh.host, label: activeSsh.displayLabel, remoteCwd: dir, port: activeSsh.port)
                            ))
                        } label: {
                            HStack {
                                Text(dir == "~" ? "默认目录 (~)" : dir)
                                if dir == currentCwd { Image(systemName: "checkmark") }
                            }
                        }
                    }
                    Divider()
                    Button("设置远端目录…") {
                        remoteCwdDraft = currentCwd
                        isCwdDialogOpen = true
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "folder")
                        Text(currentCwd == "~" ? "默认目录 (~)" : currentCwd)
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                }
                .menuStyle(.borderlessButton)
                .disabled(isDisabled)
            } else {
                Menu {
                    ForEach(projects) { item in
                        Button {
                            onSelectTarget(item)
                        } label: {
                            HStack {
                                Label(item.name, systemImage: "folder")
                                if item.path == activeProject?.path {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                    if !projects.isEmpty {
                        Divider()
                    }
                    Button {
                        onCreateProject()
                    } label: {
                        Label("新建项目", systemImage: "folder.badge.plus")
                    }
                    Button {
                        onSelectTarget(nil)
                    } label: {
                        HStack {
                            Label("未关联项目", systemImage: "folder.badge.minus")
                            if activeProject == nil {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 5) {
                        if let activeProject {
                            Image(systemName: "folder")
                            Text(activeProject.name)
                        } else {
                            Text("未关联项目")
                                .foregroundStyle(.secondary)
                        }
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(activeProject != nil ? Color.primary.opacity(0.08) : Color.clear)
                    )
                }
                .menuStyle(.borderlessButton)
                .disabled(isDisabled)
            }

            Spacer()
        }
        .padding(.horizontal, 4)
        .sheet(isPresented: $isConnectingSshDialog) {
            VStack(alignment: .leading, spacing: 14) {
                Text("连接到 SSH 主机")
                    .font(.title3.weight(.semibold))
                Text("输入 ~/.ssh/config 主机别名或 user@host，将通过系统 ssh 免密连接远端 Pi。")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                TextField("例如：my-server 或 ubuntu@192.168.1.10", text: $sshHostInput)
                    .textFieldStyle(.roundedBorder)
                TextField("远端工作目录（默认 ~）", text: $sshCwdInput)
                    .textFieldStyle(.roundedBorder)

                if let sshInputError {
                    Text(sshInputError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                HStack {
                    Spacer()
                    Button("取消") { isConnectingSshDialog = false }
                    Button("连接") { connectCustomSsh() }
                        .buttonStyle(.borderedProminent)
                        .disabled(sshHostInput.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(20)
            .frame(width: 420)
        }
        .alert("设置远端工作目录", isPresented: $isCwdDialogOpen) {
            TextField("~/workspace 或 /home/user/project", text: $remoteCwdDraft)
            Button("取消", role: .cancel) {}
            Button("应用") {
                guard let activeSsh else { return }
                let cwd = remoteCwdDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                let finalCwd = cwd.isEmpty ? "~" : cwd
                libraryStore.recordRemoteCwd(host: activeSsh.host, cwd: finalCwd)
                onSelectTarget(ProjectInfo(
                    path: finalCwd,
                    name: finalCwd == "~" ? activeSsh.displayLabel : "\(activeSsh.displayLabel):\(finalCwd)",
                    ssh: SshTarget(host: activeSsh.host, label: activeSsh.displayLabel, remoteCwd: finalCwd, port: activeSsh.port)
                ))
            }
        }
    }

    private var hostPopoverBody: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    isHostOpen = false
                    isSshPanelOpen = false
                    if activeSsh != nil { onSelectTarget(nil) }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "desktopcomputer")
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("此电脑").font(.body.weight(.medium))
                            Text("运行于 this machine")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if activeSsh == nil {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.semibold))
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Divider()

                Button {
                    withAnimation(.easeInOut(duration: 0.14)) {
                        isSshPanelOpen.toggle()
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "terminal")
                            .frame(width: 18)
                        Text("SSH 主机")
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(isSshPanelOpen ? Color.primary.opacity(0.08) : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(6)
            .frame(width: 220)

            if isSshPanelOpen {
                Divider()

                VStack(alignment: .leading, spacing: 6) {
                    TextField("搜索主机...", text: $sshQuery)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal, 8)
                        .padding(.top, 8)

                    Divider()

                    Text("SSH 配置")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)

                    if mergedHosts.isEmpty {
                        Text(configHosts.isEmpty && libraryStore.customSshHosts.isEmpty
                             ? "未在 ~/.ssh/config 中发现主机"
                             : "没有匹配的 SSH 主机")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 12)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(mergedHosts) { host in
                                    let isSelected = activeSsh?.host == host.name
                                    Button {
                                        let cwd = libraryStore.sshRemoteCwds[host.name]?.first ?? "~"
                                        isHostOpen = false
                                        onSelectTarget(ProjectInfo(
                                            path: cwd,
                                            name: cwd == "~" ? host.name : "\(host.name):\(cwd)",
                                            ssh: SshTarget(host: host.name, label: host.name, remoteCwd: cwd, port: host.port)
                                        ))
                                    } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: "terminal")
                                                .foregroundStyle(.secondary)
                                            VStack(alignment: .leading, spacing: 1) {
                                                Text(host.name).font(.callout)
                                                let sub = [host.user, host.hostName].compactMap { $0 }.joined(separator: "@")
                                                if !sub.isEmpty && sub != host.name {
                                                    Text(sub).font(.caption2).foregroundStyle(.secondary)
                                                }
                                            }
                                            Spacer()
                                            if isSelected {
                                                Image(systemName: "checkmark")
                                                    .font(.caption.weight(.semibold))
                                            }
                                        }
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                        .frame(maxHeight: 200)
                    }

                    Divider()

                    Button {
                        isHostOpen = false
                        sshInputError = nil
                        isConnectingSshDialog = true
                    } label: {
                        Label("连接到 SSH 主机...", systemImage: "plus")
                            .font(.callout)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 6)
                }
                .frame(width: 250)
            }
        }
    }

    private func connectCustomSsh() {
        do {
            let parsed = try SshConfigService.normalizeTargetInput(sshHostInput)
            let cwd = sshCwdInput.trimmingCharacters(in: .whitespacesAndNewlines)
            let finalCwd = cwd.isEmpty ? "~" : cwd
            libraryStore.recordCustomSshHost(SshHostInfo(
                name: parsed.host,
                hostName: nil,
                user: nil,
                port: parsed.port,
                source: "custom"
            ))
            libraryStore.recordRemoteCwd(host: parsed.host, cwd: finalCwd)
            isConnectingSshDialog = false
            sshHostInput = ""
            sshCwdInput = "~"
            sshInputError = nil
            onSelectTarget(ProjectInfo(
                path: finalCwd,
                name: finalCwd == "~" ? parsed.label : "\(parsed.label):\(finalCwd)",
                ssh: SshTarget(host: parsed.host, label: parsed.label, remoteCwd: finalCwd, port: parsed.port)
            ))
        } catch {
            sshInputError = error.localizedDescription
        }
    }
}
