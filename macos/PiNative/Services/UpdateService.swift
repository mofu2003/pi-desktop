import AppKit
import CryptoKit
import Foundation
import Observation

struct AvailableAppUpdate: Equatable, Sendable {
    let version: String
    let downloadUrl: URL
    let sha256: String?
    let size: Int?
}

enum AppUpdateStatus: Equatable, Sendable {
    case current
    case unavailable(version: String)
    case available(AvailableAppUpdate)
}

@Observable
@MainActor
final class UpdateService {
    var availableUpdate: AvailableAppUpdate?
    var isChecking = false
    var isInstalling = false
    var downloadProgress: Double?
    var alertMessage: (title: String, body: String, isUpdatePrompt: Bool)?

    private static let latestReleaseAPI = URL(string: "https://api.github.com/repos/mofu2003/pi-desktop/releases/latest")!
    nonisolated private static let releasesBase = "https://github.com/mofu2003/pi-desktop/releases"
    private var watcherTask: Task<Void, Never>?
    private var promptedVersion: String?
    private var lastCheckAt: Date?

    var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.6.0"
    }

    nonisolated static var currentArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }

    func startWatcher() {
        guard watcherTask == nil else { return }
        watcherTask = Task {
            while !Task.isCancelled {
                await refreshSilently(promptIfNew: true)
                try? await Task.sleep(for: .seconds(1800))
            }
        }
    }

    func refreshOnActivateIfNeeded() async {
        if let lastCheckAt, Date().timeIntervalSince(lastCheckAt) < 300 {
            return
        }
        await refreshSilently(promptIfNew: true)
    }

    func refreshSilently(promptIfNew: Bool = true) async {
        lastCheckAt = Date()
        do {
            let status = try await fetchLatestStatus()
            if case .available(let update) = status {
                availableUpdate = update
                if promptIfNew, !isInstalling, promptedVersion != update.version, alertMessage == nil {
                    promptedVersion = update.version
                    alertMessage = (
                        "发现新版本 Pi \(update.version)",
                        "当前版本为 \(currentVersion)，是否立即下载并安装更新？",
                        true
                    )
                }
            } else {
                availableUpdate = nil
            }
        } catch {
            // 离线或 GitHub API 限流时静默保留已有状态
        }
    }

    func checkManually() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }

        do {
            let status = try await fetchLatestStatus()
            switch status {
            case .current:
                availableUpdate = nil
                alertMessage = ("当前已是最新版本", "Pi \(currentVersion) 已是最新稳定版本。", false)
            case .unavailable(let version):
                availableUpdate = nil
                alertMessage = ("发现新版本 v\(version)", "GitHub Releases 暂未上传适用于本机架构（\(Self.currentArchitecture)）的安装包。", false)
            case .available(let update):
                availableUpdate = update
                alertMessage = ("发现新版本 Pi \(update.version)", "是否立即在软件内下载并安装更新？", true)
            }
        } catch {
            alertMessage = ("检查更新失败", error.localizedDescription, false)
        }
    }

    func installAvailableUpdate() async {
        guard let update = availableUpdate, !isInstalling else { return }
        isInstalling = true
        downloadProgress = 0.05
        defer {
            isInstalling = false
            downloadProgress = nil
        }

        do {
            let (tempURL, _) = try await URLSession.shared.download(from: update.downloadUrl)
            downloadProgress = 0.65

            let stagingDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("pi-native-update-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)
            let dmgURL = stagingDir.appendingPathComponent("Pi-\(update.version).dmg")
            try? FileManager.default.removeItem(at: dmgURL)
            try FileManager.default.moveItem(at: tempURL, to: dmgURL)

            if let expectedSha = update.sha256 {
                let data = try Data(contentsOf: dmgURL)
                let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                guard digest.lowercased() == expectedSha.lowercased() else {
                    try? FileManager.default.removeItem(at: stagingDir)
                    throw NSError(domain: "PiNativeUpdate", code: 1, userInfo: [
                        NSLocalizedDescriptionKey: "安装包 SHA-256 校验未通过，已取消安装。"
                    ])
                }
            }
            downloadProgress = 0.85

            let installed = try await mountAndReplaceApp(dmgURL: dmgURL)
            downloadProgress = 1.0
            if installed {
                relaunchApp(at: Bundle.main.bundleURL)
            } else {
                NSWorkspace.shared.open(dmgURL)
            }
        } catch {
            alertMessage = ("更新安装失败", error.localizedDescription, false)
        }
    }

    // MARK: - 版本解析（对齐 src/main/update-release.ts）

    nonisolated static func resolveUpdate(
        jsonData: Data,
        currentVersion: String,
        architecture: String = UpdateService.currentArchitecture
    ) throws -> AppUpdateStatus {
        guard let obj = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let tag = obj["tag_name"] as? String,
              tag.hasPrefix("v"),
              (obj["draft"] as? Bool) == false,
              (obj["prerelease"] as? Bool) == false,
              let assets = obj["assets"] as? [[String: Any]] else {
            throw NSError(domain: "PiNativeUpdate", code: 2, userInfo: [NSLocalizedDescriptionKey: "Release 数据格式无效。"])
        }

        let version = String(tag.dropFirst())
        let latestParts = try versionParts(version)
        let installedParts = try versionParts(currentVersion)

        var isNewer = false
        for idx in 0..<3 {
            if latestParts[idx] > installedParts[idx] {
                isNewer = true
                break
            } else if latestParts[idx] < installedParts[idx] {
                break
            }
        }
        guard isNewer else { return .current }

        let assetName = "Pi-\(version)-\(architecture).dmg"
        guard let asset = assets.first(where: {
            ($0["name"] as? String) == assetName && ($0["state"] as? String) == "uploaded"
        }) else {
            return .unavailable(version: version)
        }

        var sha256: String?
        if let digest = asset["digest"] as? String, digest.lowercased().hasPrefix("sha256:") {
            let hex = String(digest.dropFirst(7)).lowercased()
            if hex.count == 64 { sha256 = hex }
        }
        let size = asset["size"] as? Int
        let encodedName = assetName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? assetName
        guard let url = URL(string: "\(releasesBase)/download/\(tag)/\(encodedName)") else {
            return .unavailable(version: version)
        }

        return .available(AvailableAppUpdate(version: version, downloadUrl: url, sha256: sha256, size: size))
    }

    private func fetchLatestStatus() async throws -> AppUpdateStatus {
        var req = URLRequest(url: Self.latestReleaseAPI, timeoutInterval: 8)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw NSError(domain: "PiNativeUpdate", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "GitHub Releases 返回状态码 \(http.statusCode)"
            ])
        }
        return try Self.resolveUpdate(jsonData: data, currentVersion: currentVersion)
    }

    private nonisolated static func versionParts(_ version: String) throws -> [Int] {
        let parts = version.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 3, parts.allSatisfy({ $0 >= 0 }) else {
            throw NSError(domain: "PiNativeUpdate", code: 3, userInfo: [NSLocalizedDescriptionKey: "无效的版本号：\(version)"])
        }
        return parts
    }

    private func mountAndReplaceApp(dmgURL: URL) async throws -> Bool {
        let currentBundle = Bundle.main.bundleURL
        guard currentBundle.pathExtension == "app" else { return false }

        return try await Task.detached(priority: .userInitiated) {
            let mountPoint = FileManager.default.temporaryDirectory
                .appendingPathComponent("pi-dmg-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: mountPoint, withIntermediateDirectories: true)

            let attach = Process()
            attach.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
            attach.arguments = ["attach", dmgURL.path, "-nobrowse", "-readonly", "-mountpoint", mountPoint.path]
            try attach.run()
            attach.waitUntilExit()
            guard attach.terminationStatus == 0 else { return false }

            defer {
                let detach = Process()
                detach.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
                detach.arguments = ["detach", mountPoint.path, "-quiet"]
                try? detach.run()
                detach.waitUntilExit()
            }

            let candidateApp = mountPoint.appendingPathComponent("Pi.app")
            guard FileManager.default.fileExists(atPath: candidateApp.path) else { return false }

            let backup = currentBundle.deletingLastPathComponent().appendingPathComponent("Pi.app.bak")
            try? FileManager.default.removeItem(at: backup)
            do {
                try FileManager.default.moveItem(at: currentBundle, to: backup)
                try FileManager.default.copyItem(at: candidateApp, to: currentBundle)
                try? FileManager.default.removeItem(at: backup)
                return true
            } catch {
                if !FileManager.default.fileExists(atPath: currentBundle.path),
                   FileManager.default.fileExists(atPath: backup.path) {
                    try? FileManager.default.moveItem(at: backup, to: currentBundle)
                }
                return false
            }
        }.value
    }

    private func relaunchApp(at appURL: URL) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        proc.arguments = ["-n", appURL.path]
        try? proc.run()
        NSApplication.shared.terminate(nil)
    }
}
