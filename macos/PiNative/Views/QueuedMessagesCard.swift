import AppKit
import SwiftUI

struct QueuedMessagesCard: View {
    let items: [PendingUserMessage]
    let onSendNow: (UUID) -> Void
    let onEdit: (UUID) -> Void
    let onDelete: (UUID) -> Void

    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Text("排队中的消息")
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(.primary.opacity(0.9))

                    Text("\(items.count)")
                        .font(.system(size: 11.5, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(Color.primary.opacity(0.07))
                        )

                    Text("将在智能体完成当前工作后发送")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(items) { item in
                        QueuedMessageRow(
                            item: item,
                            onSendNow: { onSendNow(item.id) },
                            onEdit: { onEdit(item.id) },
                            onDelete: { onDelete(item.id) }
                        )
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 10)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(nsColor: .textBackgroundColor))
                .shadow(color: Color.black.opacity(0.04), radius: 8, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}

private struct QueuedMessageRow: View {
    let item: PendingUserMessage
    let onSendNow: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    private var previewText: String {
        let singleLine = item.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !singleLine.isEmpty { return singleLine }
        return item.images.isEmpty ? "空消息" : "图片消息"
    }

    var body: some View {
        HStack(spacing: 10) {
            if let firstImage = item.images.first,
               let raw = Data(base64Encoded: firstImage.data),
               let nsImage = NSImage(data: raw) {
                Image(nsImage: nsImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 24, height: 24)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5)
                    )
            }

            Text(previewText)
                .font(.system(size: 13.5))
                .foregroundStyle(.primary.opacity(0.92))
                .lineLimit(1)
                .truncationMode(.tail)

            Spacer(minLength: 8)

            HStack(spacing: 12) {
                Button(action: onSendNow) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("立即发送")

                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("放回输入框编辑")

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("从队列移除")
            }
        }
        .padding(.vertical, 2)
    }
}
