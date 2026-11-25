import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheHitPercent, summarizeTimings } from '../src/renderer/src/lib/composer-metrics.ts'

test('calculates cache hit rate from all input tokens, including cache writes', () => {
  assert.equal(cacheHitPercent({ input: 10, cacheRead: 80, cacheWrite: 10 }), 80)
  assert.equal(cacheHitPercent({ input: 0, cacheRead: 0, cacheWrite: 0 }), undefined)
  assert.equal(cacheHitPercent(), undefined)
})

test('calculates timing only from messages with recorded durations and usage', () => {
  const metrics = summarizeTimings([
    { role: 'assistant', durationMs: 1000, usage: { output: 30 } },
    { role: 'assistant', durationMs: 2000, usage: { output: 60 } },
    { role: 'assistant', durationMs: 500 },
    { role: 'assistant', usage: { output: 500 } },
    { role: 'toolResult', durationMs: 400 },
    { role: 'toolResult' }
  ])
  assert.deepEqual(metrics, { modelMs: 3500, toolMs: 400, tokensPerSecond: 30 })
  assert.deepEqual(summarizeTimings([]), { modelMs: undefined, toolMs: undefined, tokensPerSecond: undefined })
})
