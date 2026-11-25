import Foundation
import Testing
@testable import Pi

@Suite("PiNative 核心服务测试")
struct PiNativeTests {
    @Test("SSH Config 解析多别名并跳过通配符")
    func parseSshConfig() {
        let hosts = SshConfigService.parseConfigContent("""
        # Global
        Host *
          ServerAliveInterval 60

        Host win-wsl wsl-dev !*.internal
          HostName 100.64.0.1
          User fansicheng
          Port 2222

        Host mofu-225
          HostName 192.168.1.225
          User ubuntu
        """)

        #expect(hosts.count == 3)
        #expect(hosts[0].name == "win-wsl")
        #expect(hosts[0].port == 2222)
        #expect(hosts[1].name == "wsl-dev")
        #expect(hosts[2].name == "mofu-225")
        #expect(hosts[2].user == "ubuntu")
    }

    @Test("SSH 目标输入校验拦截注入与非法字符")
    func validateSshTargetInput() throws {
        let simple = try SshConfigService.normalizeTargetInput("mofu-225")
        #expect(simple.host == "mofu-225")
        #expect(simple.port == nil)

        let withCmd = try SshConfigService.normalizeTargetInput("ssh -p 2222 ubuntu@10.0.0.5")
        #expect(withCmd.host == "ubuntu@10.0.0.5")
        #expect(withCmd.port == 2222)

        #expect(throws: SshInputError.self) {
            _ = try SshConfigService.normalizeTargetInput("-oProxyCommand=id")
        }
        #expect(throws: SshInputError.self) {
            _ = try SshConfigService.normalizeTargetInput("host; rm -rf /")
        }
    }

    @Test("精确计算缓存命中率与有效 tok/s")
    func calculateMetrics() {
        let tokens = PiSessionStats.Tokens(input: 50, output: 20, cacheRead: 150, cacheWrite: 50, total: 270)
        let hitRate = MetricsCalculator.cacheHitPercent(tokens)
        #expect(hitRate == 60.0)

        let assistant = AgentMessage(
            role: "assistant",
            content: .text("hello"),
            api: nil,
            provider: nil,
            model: nil,
            responseModel: nil,
            usage: AgentUsage(input: 10, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: nil),
            stopReason: "stop",
            errorMessage: nil,
            timestamp: 1000,
            durationMs: 2000,
            toolCallId: nil,
            toolName: nil,
            details: nil,
            isError: nil,
            command: nil,
            output: nil,
            exitCode: nil,
            cancelled: nil,
            truncated: nil,
            fullOutputPath: nil,
            excludeFromContext: nil,
            customType: nil,
            display: nil,
            summary: nil,
            fromId: nil,
            tokensBefore: nil
        )
        let timing = MetricsCalculator.summarizeTimings(messages: [assistant])
        #expect(timing.modelMs == 2000)
        #expect(timing.tokensPerSecond == 50.0)
    }

    @Test("思考档位排序优先使用运行时能力列表")
    func thinkingLevelsOrdering() {
        let levels = MetricsCalculator.supportedThinkingLevels(
            model: nil,
            runtimeLevels: [.high, .off, .low]
        )
        #expect(levels == [.off, .low, .high])
    }

    @Test("软件内更新解析匹配架构安装包")
    func resolveAppUpdate() throws {
        let json = """
        {
          "tag_name": "v0.7.0",
          "draft": false,
          "prerelease": false,
          "assets": [
            {
              "name": "Pi-0.7.0-arm64.dmg",
              "state": "uploaded",
              "size": 123456,
              "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }
          ]
        }
        """.data(using: .utf8)!

        let status = try UpdateService.resolveUpdate(jsonData: json, currentVersion: "0.6.0", architecture: "arm64")
        guard case .available(let update) = status else {
            Issue.record("Expected available update")
            return
        }
        #expect(update.version == "0.7.0")
        #expect(update.sha256 == "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    }
}
