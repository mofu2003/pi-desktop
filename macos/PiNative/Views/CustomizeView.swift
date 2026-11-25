import SwiftUI

struct CustomizeView: View {
    let project: ProjectInfo?
    let onBack: () -> Void

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
