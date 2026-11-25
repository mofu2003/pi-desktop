import AppKit
import SwiftUI

struct ForkSheetPayload: Identifiable {
    let id = UUID()
    let messages: [ForkableMessage]
}

struct CreateProjectSheet: View {
    let existingProjects: [ProjectInfo]
    let onCreate: (ProjectInfo) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var folderURL: URL?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("新建项目")
                .font(.title3.weight(.semibold))

            TextField("项目名称", text: $name)
                .textFieldStyle(.roundedBorder)

            HStack {
                Text(folderURL?.path ?? "未选择文件夹（将创建独立工作区）")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("选择文件夹…") {
                    let panel = NSOpenPanel()
                    panel.canChooseFiles = false
                    panel.canChooseDirectories = true
                    panel.allowsMultipleSelection = false
                    if panel.runModal() == .OK, let url = panel.url {
                        folderURL = url
                        if name.trimmingCharacters(in: .whitespaces).isEmpty {
                            name = url.lastPathComponent
                        }
                    }
                }
            }

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("取消") { dismiss() }
                Button("创建") {
                    do {
                        let created = try SessionStore.createProject(name: name, sourceFolder: folderURL)
                        onCreate(created)
                    } catch let err {
                        error = err.localizedDescription
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}

struct ForkSessionSheet: View {
    let messages: [ForkableMessage]
    let isForking: Bool
    let onSelect: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("从历史消息分叉")
                .font(.title3.weight(.semibold))
            Text("选择一条历史用户消息作为分叉起点，生成新会话。")
                .font(.body)
                .foregroundStyle(.secondary)

            if messages.isEmpty {
                Text("当前会话没有可用于分叉的用户消息。")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                List(messages) { item in
                    Button {
                        onSelect(item.entryId)
                    } label: {
                        HStack {
                            Text(item.text)
                                .lineLimit(2)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isForking)
                }
                .frame(height: 240)
            }

            HStack {
                Spacer()
                Button("取消", action: onCancel)
                    .disabled(isForking)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}

struct ExtensionRequestSheet: View {
    let request: ExtensionRequest
    let onRespond: (String?, Bool?, Bool) -> Void

    @State private var inputValue: String

    init(request: ExtensionRequest, onRespond: @escaping (String?, Bool?, Bool) -> Void) {
        self.request = request
        self.onRespond = onRespond
        _inputValue = State(initialValue: request.prefill ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(request.title)
                .font(.title3.weight(.semibold))
            if let message = request.message, !message.isEmpty {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if request.method == "select" {
                List(request.options, id: \.self) { option in
                    Button(option) {
                        onRespond(option, nil, false)
                    }
                }
                .frame(height: 200)
            } else if request.method == "input" || request.method == "editor" {
                TextEditor(text: $inputValue)
                    .font(.body)
                    .frame(height: request.method == "editor" ? 160 : 44)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.25)))
            }

            HStack {
                Spacer()
                Button("取消") { onRespond(nil, nil, true) }
                if request.method == "confirm" {
                    Button("确认") { onRespond(nil, true, false) }
                        .buttonStyle(.borderedProminent)
                } else if request.method == "input" || request.method == "editor" {
                    Button("确定") { onRespond(inputValue, nil, false) }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}
