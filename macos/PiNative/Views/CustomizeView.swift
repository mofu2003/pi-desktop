import AppKit
import SwiftUI

struct CustomizeView: View {
    let project: ProjectInfo?
    let onBack: () -> Void

    @State private var resources: [CustomizationResource] = []
    @State private var selected: CustomizationResource?
    @State private var previewContent = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onBack) {
                    Label("返回对话", systemImage: "chevron.left")
                }
                .buttonStyle(.bordered)
                Spacer()
                Text("自定义资源（Skills 与 Extensions）")
                    .font(.headline)
                Spacer()
                Button {
                    resources = CustomizationService.listResources(projectCwd: project?.path)
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding()
            Divider()

            HSplitView {
                List(resources, selection: Binding(
                    get: { selected?.id },
                    set: { id in
                        selected = resources.first(where: { $0.id == id })
                        previewContent = selected.map { CustomizationService.readPreview(at: $0.location) } ?? ""
                    }
                )) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(item.name)
                                .font(.body.weight(.medium))
                            Spacer()
                            Text(item.scope == "project" ? "项目" : "全局")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.secondary.opacity(0.14)))
                        }
                        if let desc = item.description, !desc.isEmpty {
                            Text(desc)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .frame(minWidth: 260, idealWidth: 300)

                if let selected {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(selected.name)
                                    .font(.title3.weight(.semibold))
                                Text(selected.location)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                            Spacer()
                            Button("在 Finder 中显示") {
                                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: selected.location)])
                            }
                        }
                        Divider()
                        ScrollView {
                            Text(previewContent.isEmpty ? "（无可预览内容）" : previewContent)
                                .font(.system(.callout, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding()
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "puzzlepiece.extension")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("从左侧选择一个 Skill 或 Extension 查看详情")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .onAppear {
            resources = CustomizationService.listResources(projectCwd: project?.path)
        }
    }
}
