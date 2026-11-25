import SwiftUI

/// 原版三色几何 Pi 徽标（对应 build/icon.svg 与 PiMark.tsx，坐标系 800x800）
struct PiMarkView: View {
    var size: CGFloat = 44
    var showCardFrame: Bool = true

    var body: some View {
        let mark = Canvas { context, canvasSize in
            let sx = canvasSize.width / 800.0
            let sy = canvasSize.height / 800.0
            let scale = CGAffineTransform(scaleX: sx, y: sy)

            var topBar = Path()
            topBar.move(to: CGPoint(x: 165.29, y: 165.29))
            topBar.addLine(to: CGPoint(x: 517.36, y: 165.29))
            topBar.addLine(to: CGPoint(x: 517.36, y: 400))
            topBar.addLine(to: CGPoint(x: 400, y: 400))
            topBar.addLine(to: CGPoint(x: 400, y: 282.65))
            topBar.addLine(to: CGPoint(x: 165.29, y: 282.65))
            topBar.closeSubpath()
            context.fill(topBar.applying(scale), with: .color(Color(red: 0xF0 / 255.0, green: 0x90 / 255.0, blue: 0x82 / 255.0)))

            var leftPillar = Path()
            leftPillar.move(to: CGPoint(x: 165.29, y: 282.65))
            leftPillar.addLine(to: CGPoint(x: 282.65, y: 282.65))
            leftPillar.addLine(to: CGPoint(x: 282.65, y: 400))
            leftPillar.addLine(to: CGPoint(x: 400, y: 400))
            leftPillar.addLine(to: CGPoint(x: 400, y: 517.36))
            leftPillar.addLine(to: CGPoint(x: 282.65, y: 517.36))
            leftPillar.addLine(to: CGPoint(x: 282.65, y: 634.72))
            leftPillar.addLine(to: CGPoint(x: 165.29, y: 634.72))
            leftPillar.closeSubpath()
            context.fill(leftPillar.applying(scale), with: .color(Color(red: 0x4D / 255.0, green: 0x9A / 255.0, blue: 0xBF / 255.0)))

            var rightFoot = Path()
            rightFoot.move(to: CGPoint(x: 517.36, y: 400))
            rightFoot.addLine(to: CGPoint(x: 634.72, y: 400))
            rightFoot.addLine(to: CGPoint(x: 634.72, y: 634.72))
            rightFoot.addLine(to: CGPoint(x: 517.36, y: 634.72))
            rightFoot.closeSubpath()
            context.fill(rightFoot.applying(scale), with: .color(Color(red: 0xF1 / 255.0, green: 0xBE / 255.0, blue: 0x58 / 255.0)))
        }
        .frame(width: size, height: size)

        if showCardFrame {
            mark
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                )
                .shadow(color: Color.black.opacity(0.06), radius: 6, y: 2)
        } else {
            mark
        }
    }
}
