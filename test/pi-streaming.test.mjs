import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAssistantMessageUpdate } from '../src/renderer/src/lib/pi.ts'

const assistant = {
  role: 'assistant',
  content: [],
  stopReason: 'pending',
  timestamp: 100
}

test('builds a live thinking block from delta-only Pi 1.6 events', () => {
  let messages = [assistant]
  messages = applyAssistantMessageUpdate(messages, {
    type: 'thinking_start',
    contentIndex: 0
  })
  messages = applyAssistantMessageUpdate(messages, {
    type: 'thinking_delta',
    contentIndex: 0,
    delta: '正在检查'
  })
  messages = applyAssistantMessageUpdate(messages, {
    type: 'thinking_delta',
    contentIndex: 0,
    delta: '输入区'
  })

  assert.deepEqual(messages[0].content, [
    { type: 'thinking', thinking: '正在检查输入区' }
  ])
})

test('replaces streamed thinking with authoritative completion text', () => {
  const messages = applyAssistantMessageUpdate(
    [assistant, {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'partial' },
        { type: 'text', text: 'partial text' }
      ],
      stopReason: 'pending',
      timestamp: 200
    }],
    {
      type: 'thinking_end',
      contentIndex: 0,
      content: '完整思考'
    }
  )

  assert.deepEqual(messages.at(-1).content[0], {
    type: 'thinking',
    thinking: '完整思考'
  })
})
