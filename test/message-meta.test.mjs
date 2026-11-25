import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assistantTurnElapsedMs,
  assistantTurnStartedAt,
  formatElapsedDuration,
  formatLocalTimestamp,
  formatTokenUsage,
  isFinalAssistantOfTurn,
  userMessageEntryIds
} from '../src/renderer/src/lib/message-meta.ts'

test('finds the user message that started an assistant turn', () => {
  const messages = [
    { role: 'user', content: '一', timestamp: 100 },
    { role: 'assistant', content: [], timestamp: 200 },
    { role: 'toolResult', content: [], isError: false, toolCallId: 'a', toolName: 'read', timestamp: 300 },
    { role: 'assistant', content: [], timestamp: 400 },
    { role: 'user', content: '二', timestamp: 900 }
  ]
  assert.equal(assistantTurnStartedAt(messages, 1), 100)
  assert.equal(assistantTurnStartedAt(messages, 3), 100)
  assert.equal(assistantTurnStartedAt(messages, 0), undefined)
})

test('sums the turn duration and finds the final assistant message', () => {
  const messages = [
    { role: 'user', content: '一', timestamp: 100 },
    { role: 'assistant', content: [], timestamp: 200, durationMs: 1000 },
    { role: 'toolResult', content: [], isError: false, toolCallId: 'a', toolName: 'read', timestamp: 1300, durationMs: 300 },
    { role: 'assistant', content: [], timestamp: 1400, durationMs: 2000 },
    { role: 'user', content: '二', timestamp: 9000 },
    { role: 'assistant', content: [], timestamp: 9100, durationMs: 500 }
  ]
  assert.equal(isFinalAssistantOfTurn(messages, 1), false)
  assert.equal(isFinalAssistantOfTurn(messages, 3), true)
  assert.equal(isFinalAssistantOfTurn(messages, 5), true)
  assert.equal(assistantTurnElapsedMs(messages, 1, 0, false), 3300)
  assert.equal(assistantTurnElapsedMs(messages, 3, 0, false), 3300)
  assert.equal(assistantTurnElapsedMs(messages, 5, 0, false), 500)
})

test('adds live time for the assistant message still streaming', () => {
  const messages = [
    { role: 'user', content: '一', timestamp: 100 },
    { role: 'assistant', content: [], timestamp: 2000, durationMs: 1000 },
    { role: 'assistant', content: [], timestamp: 8000 }
  ]
  assert.equal(assistantTurnElapsedMs(messages, 2, 12_000, true), 5000)
  assert.equal(assistantTurnElapsedMs(messages, 2, 12_000, false), 1000)
})

test('formats elapsed durations for the message header', () => {
  assert.equal(formatElapsedDuration(undefined), undefined)
  assert.equal(formatElapsedDuration(0), '不到 1 秒')
  assert.equal(formatElapsedDuration(999), '1 秒')
  assert.equal(formatElapsedDuration(12_000), '12 秒')
  assert.equal(formatElapsedDuration(270_000), '4 分 30 秒')
  assert.equal(formatElapsedDuration(120_000), '2 分')
  assert.equal(formatElapsedDuration(3_720_000), '1 小时 2 分')
})

test('formats token counts compactly', () => {
  assert.equal(formatTokenUsage(undefined), undefined)
  assert.equal(formatTokenUsage(4204), '4.2K tok')
  assert.equal(formatTokenUsage(721_000), '721K tok')
  assert.equal(formatTokenUsage(1_200_000), '1.2M tok')
})

test('formats message time in the local time zone with its name', () => {
  const formatted = formatLocalTimestamp(Date.UTC(2026, 10, 25, 8, 7))
  assert.ok(formatted?.includes('月'))
  assert.ok(formatted?.includes('日'))
  assert.match(formatted ?? '', /\d{1,2}:\d{2}/)
  assert.match(formatted ?? '', /(GMT|UTC)/)
  assert.equal(formatLocalTimestamp(undefined), undefined)
})

test('maps user messages on the active branch to entry ids', () => {
  const entries = [
    { id: 'root', parentId: null, message: { role: 'system', timestamp: 1 } },
    { id: 'u1', parentId: 'root', message: { role: 'user', timestamp: 10 } },
    { id: 'a1', parentId: 'u1', message: { role: 'assistant', timestamp: 20 } },
    { id: 'u-abandoned', parentId: 'a1', message: { role: 'user', timestamp: 30 } },
    { id: 'u2', parentId: 'a1', message: { role: 'user', timestamp: 40 } },
    { id: 'a2', parentId: 'u2', message: { role: 'assistant', timestamp: 50 } }
  ]
  assert.deepEqual(userMessageEntryIds(entries, 'a2'), { 10: 'u1', 40: 'u2' })
  assert.deepEqual(userMessageEntryIds(entries, null), {})
  assert.deepEqual(userMessageEntryIds(entries, 'missing'), {})
})
