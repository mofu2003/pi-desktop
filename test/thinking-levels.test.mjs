import assert from 'node:assert/strict'
import test from 'node:test'
import { supportedThinkingLevels } from '../src/renderer/src/lib/thinking-levels.ts'

test('uses the runtime levels in ascending order', () => {
  const model = { reasoning: true, thinkingLevelMap: { max: 'max' } }
  assert.deepEqual(supportedThinkingLevels(model, ['max', 'off', 'medium', 'medium']),
    ['off', 'medium', 'max'])
  assert.deepEqual(supportedThinkingLevels(model, []), [])
})

test('uses model capabilities when older RPC servers omit the levels', () => {
  assert.deepEqual(supportedThinkingLevels({ reasoning: false }), ['off'])
  assert.deepEqual(supportedThinkingLevels({
    reasoning: true,
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', max: 'max' }
  }), ['off', 'high', 'max'])
  assert.deepEqual(supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { xhigh: 'xhigh' } }),
    ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
})
