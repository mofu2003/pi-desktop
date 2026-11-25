import Foundation

struct TimingSummary: Equatable, Sendable {
    let modelMs: Double?
    let toolMs: Double?
    let tokensPerSecond: Double?
}

enum MetricsCalculator {
    static func nonnegative(_ value: Int?) -> Int? {
        guard let value, value >= 0 else { return nil }
        return value
    }

    static func nonnegative(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        return value
    }

    static func cacheHitPercent(_ tokens: PiSessionStats.Tokens?) -> Double? {
        guard let tokens else { return nil }
        let inputTotal = max(0, tokens.input) + max(0, tokens.cacheRead) + max(0, tokens.cacheWrite)
        guard inputTotal > 0 else { return nil }
        return Double(max(0, tokens.cacheRead)) / Double(inputTotal) * 100.0
    }

    static func summarizeTimings(messages: [AgentMessage]) -> TimingSummary {
        var modelMs = 0.0
        var hasModelMs = false
        var toolMs = 0.0
        var hasToolMs = false
        var speedOutputTokens = 0
        var speedModelMs = 0.0

        for message in messages {
            guard let duration = nonnegative(message.durationMs) else { continue }
            if message.role == "assistant" {
                modelMs += duration
                hasModelMs = true
                if duration > 0, let output = message.usage?.output, output >= 0 {
                    speedOutputTokens += output
                    speedModelMs += duration
                }
            } else if message.role == "toolResult" {
                toolMs += duration
                hasToolMs = true
            }
        }

        let tps: Double? = speedModelMs > 0
            ? Double(speedOutputTokens) / (speedModelMs / 1000.0)
            : nil

        return TimingSummary(
            modelMs: hasModelMs ? modelMs : nil,
            toolMs: hasToolMs ? toolMs : nil,
            tokensPerSecond: tps
        )
    }

    static func supportedThinkingLevels(model: PiModel?, runtimeLevels: [ThinkingLevel]?) -> [ThinkingLevel] {
        if let runtimeLevels, !runtimeLevels.isEmpty {
            let ordered = ThinkingLevel.allCases.filter { runtimeLevels.contains($0) }
            if !ordered.isEmpty { return ordered }
        }
        guard let model else { return [.off] }
        if model.reasoning == false { return [.off] }
        if let map = model.thinkingLevelMap, !map.isEmpty {
            let keys = ThinkingLevel.allCases.filter { level in
                if let val = map[level.rawValue] {
                    return val != nil
                }
                return false
            }
            if !keys.isEmpty { return keys }
        }
        return [.off, .minimal, .low, .medium, .high]
    }
}
