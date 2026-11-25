import Foundation

enum PiHostEvent: Sendable {
    case rpcEvent([String: JSONValue])
    case agentEnded([AgentMessage]?)
    case hostError(String)
    case hostStopped
    case protocolError(String)
}

enum PiHostError: LocalizedError {
    case alreadyConnecting
    case projectMissing
    case notRunning
    case timeout(String)
    case commandFailed(String)
    case processExited(String)

    var errorDescription: String? {
        switch self {
        case .alreadyConnecting:
            return "Pi 正在连接，请稍候。"
        case .projectMissing:
            return "项目目录不存在。请重新选择项目。"
        case .notRunning:
            return "Pi 未运行。"
        case .timeout(let cmd):
            return "Pi 命令超时：\(cmd)"
        case .commandFailed(let message):
            return message
        case .processExited(let message):
            return message
        }
    }
}

actor PiProcessHost {
    private var process: Process?
    private var stdinHandle: FileHandle?
    private var stdoutBuffer = Data()
    private var stderrText = ""
    private var requestCounter = 0
    private var pending: [String: CheckedContinuation<[String: JSONValue], Error>] = [:]
    private var timeoutTasks: [String: Task<Void, Never>] = [:]
    private var isStarting = false
    private var currentCwd = ""
    private var currentBinary = ""
    private var currentSshTarget: SshTarget?

    private var eventContinuation: AsyncStream<PiHostEvent>.Continuation?
    private var stdoutStreamTask: Task<Void, Never>?
    private var stderrStreamTask: Task<Void, Never>?
    private var stdoutStreamCont: AsyncStream<Data>.Continuation?
    private var stderrStreamCont: AsyncStream<Data>.Continuation?

    nonisolated func events() -> AsyncStream<PiHostEvent> {
        AsyncStream { continuation in
            Task { await self.setEventContinuation(continuation) }
        }
    }

    private func setEventContinuation(_ continuation: AsyncStream<PiHostEvent>.Continuation) {
        self.eventContinuation?.finish()
        self.eventContinuation = continuation
    }

    static func resolvePiBinary() -> String {
        if let env = ProcessInfo.processInfo.environment["PI_BINARY"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty {
            return env
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            home.appendingPathComponent(".npm-global/bin/pi").path,
            home.appendingPathComponent(".local/bin/pi").path,
            "/opt/homebrew/bin/pi",
            "/usr/local/bin/pi"
        ]
        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }

        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let lookup = Process()
        lookup.executableURL = URL(fileURLWithPath: shell)
        lookup.arguments = ["-lc", "command -v pi"]
        let pipe = Pipe()
        lookup.standardOutput = pipe
        lookup.standardError = Pipe()
        if (try? lookup.run()) != nil {
            lookup.waitUntilExit()
            let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let output, !output.isEmpty {
                return output
            }
        }
        return "pi"
    }

    private static func buildEnvironment(binary: String) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let binDir = URL(fileURLWithPath: binary).deletingLastPathComponent().path
        let existing = (env["PATH"] ?? "").split(separator: ":").map(String.init)
        let extra = [
            binDir,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(home)/.local/bin",
            "\(home)/.npm-global/bin"
        ]
        var seen = Set<String>()
        var merged: [String] = []
        for item in (extra + existing) where !item.isEmpty && seen.insert(item).inserted {
            merged.append(item)
        }
        env["PATH"] = merged.joined(separator: ":")
        return env
    }

    func start(cwd: String, sessionPath: String? = nil, ssh: SshTarget? = nil, idle: Bool = false) async throws -> BootstrapPayload {
        if isStarting { throw PiHostError.alreadyConnecting }

        if ssh == nil {
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: cwd, isDirectory: &isDir), isDir.boolValue else {
                throw PiHostError.projectMissing
            }
        }

        isStarting = true
        defer { isStarting = false }

        await stop(emit: false)
        currentSshTarget = ssh
        currentCwd = ssh.map { $0.remoteCwd?.isEmpty == false ? $0.remoteCwd! : "~" } ?? cwd
        currentBinary = ssh != nil ? "/usr/bin/ssh" : Self.resolvePiBinary()
        stdoutBuffer.removeAll(keepingCapacity: false)
        stderrText = ""

        let proc = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        if let ssh {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
            proc.arguments = try SshConfigService.buildSpawnArguments(target: ssh, idle: idle, sessionPath: sessionPath)
        } else {
            var args = ["--mode", "rpc"]
            if idle {
                args.append(contentsOf: ["--no-session", "--no-extensions"])
            } else if let sessionPath, !sessionPath.isEmpty {
                args.append(contentsOf: ["--session", sessionPath])
            }
            if currentBinary == "pi" {
                proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                proc.arguments = ["pi"] + args
            } else {
                proc.executableURL = URL(fileURLWithPath: currentBinary)
                proc.arguments = args
            }
            proc.currentDirectoryURL = URL(fileURLWithPath: cwd)
            proc.environment = Self.buildEnvironment(binary: currentBinary)
        }

        proc.standardInput = stdinPipe
        proc.standardOutput = stdoutPipe
        proc.standardError = stderrPipe

        self.process = proc
        self.stdinHandle = stdinPipe.fileHandleForWriting

        let (outStream, outCont) = AsyncStream<Data>.makeStream()
        let (errStream, errCont) = AsyncStream<Data>.makeStream()
        self.stdoutStreamCont = outCont
        self.stderrStreamCont = errCont

        self.stdoutStreamTask = Task { [weak self] in
            for await chunk in outStream {
                await self?.handleStdoutData(chunk, from: proc)
            }
        }
        self.stderrStreamTask = Task { [weak self] in
            for await chunk in errStream {
                await self?.handleStderrData(chunk, from: proc)
            }
        }

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                outCont.finish()
                return
            }
            outCont.yield(data)
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                errCont.finish()
                return
            }
            errCont.yield(data)
        }

        proc.terminationHandler = { [weak self] terminated in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            outCont.finish()
            errCont.finish()
            Task { await self?.handleTermination(of: terminated) }
        }

        do {
            try proc.run()
        } catch {
            await stop(emit: false)
            if ssh != nil {
                throw PiHostError.processExited("无法启动系统 ssh 客户端：\(error.localizedDescription)")
            }
            throw PiHostError.processExited("找不到 Pi 命令行工具（\(currentBinary)）：\(error.localizedDescription)")
        }

        do {
            async let stateRes = request(["type": .string("get_state")])
            async let levelsRes = try? request(["type": .string("get_available_thinking_levels")])
            async let messagesRes = request(["type": .string("get_messages")])
            async let modelsRes = request(["type": .string("get_available_models")])
            async let statsRes = try? request(["type": .string("get_session_stats")])
            async let commandsRes = request(["type": .string("get_commands")])

            let stateRaw = try await stateRes
            let levelsRaw = await levelsRes
            let messagesRaw = try await messagesRes
            let modelsRaw = try await modelsRes
            let statsRaw = await statsRes
            let commandsRaw = try await commandsRes

            guard stateRaw["success"]?.boolValue == true, let stateData = stateRaw["data"] else {
                let err = stateRaw["error"]?.stringValue ?? "Pi 未返回会话状态。"
                throw PiHostError.commandFailed(err)
            }

            var state: PiSessionState = try decodeJSONValue(stateData)
            if let levelsData = levelsRaw?["data"]?["levels"] {
                state.availableThinkingLevels = try? decodeJSONValue(levelsData)
            }

            let messages: [AgentMessage] = (try? messagesRaw["data"]?["messages"].map(decodeJSONValue)) ?? []
            let models: [PiModel] = (try? modelsRaw["data"]?["models"].map(decodeJSONValue)) ?? []
            let stats: PiSessionStats? = statsRaw?["data"].flatMap { try? decodeJSONValue($0) }
            let commands: [PiCommandInfo] = (try? commandsRaw["data"]?["commands"].map(decodeJSONValue)) ?? []

            return BootstrapPayload(
                cwd: currentCwd,
                piPath: currentBinary,
                ssh: ssh,
                state: state,
                messages: messages,
                models: models,
                stats: stats,
                commands: commands
            )
        } catch {
            await stop(emit: false)
            throw enrichStartError(error)
        }
    }

    func command(_ payload: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard process != nil, process?.isRunning == true else {
            throw PiHostError.notRunning
        }
        let response = try await request(payload)
        if response["type"]?.stringValue == "response",
           response["success"]?.boolValue == false {
            let err = response["error"]?.stringValue ?? "命令执行失败。"
            throw PiHostError.commandFailed(err)
        }
        return response
    }

    func getMessages() async throws -> [AgentMessage]? {
        let response = try await command(["type": .string("get_messages")])
        return try response["data"]?["messages"].map(decodeJSONValue)
    }

    func stop(emit: Bool = true) async {
        let proc = process
        process = nil
        stdinHandle = nil
        stdoutStreamCont?.finish()
        stderrStreamCont?.finish()
        stdoutStreamCont = nil
        stderrStreamCont = nil
        stdoutStreamTask?.cancel()
        stderrStreamTask?.cancel()
        stdoutStreamTask = nil
        stderrStreamTask = nil

        for (id, continuation) in pending {
            timeoutTasks[id]?.cancel()
            continuation.resume(throwing: PiHostError.processExited("Pi 已停止。"))
        }
        pending.removeAll()
        timeoutTasks.removeAll()

        if let proc, proc.isRunning {
            proc.terminate()
            try? await Task.sleep(for: .milliseconds(150))
            if proc.isRunning {
                kill(proc.processIdentifier, SIGKILL)
            }
        }
        if emit {
            eventContinuation?.yield(.hostStopped)
        }
    }

    // MARK: - 内部通信处理

    private func request(_ command: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let proc = process, proc.isRunning, let handle = stdinHandle else {
            throw PiHostError.notRunning
        }

        requestCounter += 1
        let id = "desktop-\(requestCounter)"
        var body = command
        body["id"] = .string(id)
        let cmdType = command["type"]?.stringValue ?? "unknown"

        let encoded = try JSONEncoder().encode(body) + Data([0x0A])

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation

            let timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                await self?.expireRequest(id: id, commandType: cmdType)
            }
            timeoutTasks[id] = timeout

            do {
                try handle.write(contentsOf: encoded)
            } catch {
                timeout.cancel()
                timeoutTasks.removeValue(forKey: id)
                if let cont = pending.removeValue(forKey: id) {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    private func expireRequest(id: String, commandType: String) {
        timeoutTasks.removeValue(forKey: id)
        if let continuation = pending.removeValue(forKey: id) {
            continuation.resume(throwing: PiHostError.timeout(commandType))
        }
    }

    private func handleStdoutData(_ data: Data, from proc: Process) {
        guard proc === process else { return }
        stdoutBuffer.append(data)

        var searchStart = stdoutBuffer.startIndex
        while let newlineIndex = stdoutBuffer[searchStart...].firstIndex(of: 0x0A) {
            let lineData = stdoutBuffer[searchStart..<newlineIndex]
            searchStart = stdoutBuffer.index(after: newlineIndex)

            guard let rawLine = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
                  !rawLine.isEmpty else {
                continue
            }

            do {
                let message = try JSONDecoder().decode([String: JSONValue].self, from: Data(rawLine.utf8))
                if message["type"]?.stringValue == "response",
                   let id = message["id"]?.stringValue,
                   let continuation = pending.removeValue(forKey: id) {
                    timeoutTasks.removeValue(forKey: id)?.cancel()
                    continuation.resume(returning: message)
                    continue
                }
                if message["type"]?.stringValue == "agent_end" {
                    let messages: [AgentMessage]? = try? message["messages"].map(decodeJSONValue)
                    eventContinuation?.yield(.agentEnded(messages))
                } else {
                    eventContinuation?.yield(.rpcEvent(message))
                }
            } catch {
                eventContinuation?.yield(.protocolError(String(rawLine.prefix(1000))))
            }
        }
        if searchStart > stdoutBuffer.startIndex {
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex..<searchStart)
        }
    }

    private func handleStderrData(_ data: Data, from proc: Process) {
        guard proc === process, let text = String(data: data, encoding: .utf8) else { return }
        stderrText += text
        if stderrText.count > 60_000 {
            stderrText = String(stderrText.suffix(30_000))
        }
    }

    private func handleTermination(of proc: Process) {
        guard proc === process else { return }
        process = nil
        stdinHandle = nil
        let tail = stderrTail()
        let detail = proc.terminationReason == .uncaughtSignal
            ? "信号 \(proc.terminationStatus)"
            : "退出码 \(proc.terminationStatus)"
        let message = tail.isEmpty ? "Pi 已退出（\(detail)）。" : "Pi 已退出（\(detail)）。\n\(tail)"
        let error = PiHostError.processExited(message)

        for (id, continuation) in pending {
            timeoutTasks[id]?.cancel()
            continuation.resume(throwing: error)
        }
        pending.removeAll()
        timeoutTasks.removeAll()

        eventContinuation?.yield(.hostError(message))
    }

    private func enrichStartError(_ error: Error) -> Error {
        let tail = stderrTail()
        let lower = tail.lowercased()
        if let ssh = currentSshTarget {
            let label = ssh.displayLabel
            if lower.contains("permission denied") {
                return PiHostError.processExited("SSH 主机「\(label)」免密认证失败，请检查 SSH 密钥或 ssh-agent。\n\(tail)")
            }
            if lower.contains("host key verification failed") {
                return PiHostError.processExited("SSH 主机「\(label)」主机密钥校验未通过，请先在终端执行一次 ssh \(ssh.host) 确认指纹。\n\(tail)")
            }
            if lower.contains("command not found") || lower.contains("not found") {
                return PiHostError.processExited("远程主机「\(label)」未找到 pi 命令，请确认已在远端安装 pi。\n\(tail)")
            }
            if lower.contains("timed out") || lower.contains("could not resolve") || lower.contains("connection refused") {
                return PiHostError.processExited("无法连接到 SSH 主机「\(label)」。\n\(tail)")
            }
        }
        if !tail.isEmpty, !error.localizedDescription.contains(tail) {
            return PiHostError.processExited("\(error.localizedDescription)\n\(tail)")
        }
        return error
    }

    private func stderrTail() -> String {
        stderrText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .newlines)
            .suffix(8)
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func decodeJSONValue<T: Decodable>(_ value: JSONValue) throws -> T {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private extension JSONValue {
    subscript(key: String) -> JSONValue? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }
}
