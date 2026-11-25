import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PiHost, listProjectSessions, renameSessionFile } from '../src/main/pi-host.ts'

test('rapid starts and a missing project leave the running Pi session usable', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-host-test-'))
  const executable = join(cwd, 'pi')
  const host = new PiHost()
  const previous = process.env.PI_BINARY
  try {
    await writeFile(executable, `#!${process.execPath}
const rl = require('node:readline').createInterface({input: process.stdin})
rl.on('line', line => {
  const { id, type } = JSON.parse(line)
  setTimeout(() => console.log(JSON.stringify({
    id, type: 'response', command: type, success: true, data: { sessionId: 'test' }
  })), 10)
})
`, { mode: 0o700 })
    process.env.PI_BINARY = executable
    const start = host.start({ cwd })
    const repeated = assert.rejects(host.start({ cwd }), /正在连接/)
    await Promise.all([start, repeated])
    await assert.rejects(host.start({ cwd: join(cwd, 'missing') }), /项目目录不存在/)
    assert.equal((await host.command({ type: 'new_session' })).success, true)
  } finally {
    await host.stop(false)
    if (previous === undefined) delete process.env.PI_BINARY
    else process.env.PI_BINARY = previous
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the packaged binary connects without a project and starts durable sessions in a project', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-bundled-test-'))
  const executable = join(cwd, 'bundled-pi')
  const host = new PiHost(executable)
  try {
    await writeFile(executable, `#!${process.execPath}
const rl = require('node:readline').createInterface({input: process.stdin})
const { argv } = process
rl.on('line', line => {
  const { id, type } = JSON.parse(line)
  console.log(JSON.stringify({
    id, type: 'response', command: type, success: true, data: {
      sessionId: argv.includes('--no-session') ? 'idle' : 'project',
      args: argv.slice(2)
    }
  }))
})
`, { mode: 0o700 })
    const idle = await host.startIdle(cwd)
    assert.equal(idle.piPath, executable)
    assert.equal(idle.state.sessionId, 'idle')
    assert.deepEqual(idle.state.args, ['--mode', 'rpc', '--no-session', '--no-extensions'])
    const active = await host.start({ cwd })
    assert.equal(active.piPath, executable)
    assert.equal(active.state.sessionId, 'project')
    assert.deepEqual(active.state.args, ['--mode', 'rpc'])
  } finally {
    await host.stop(false)
    await rm(cwd, { recursive: true, force: true })
  }
})

test('allows all native Pi RPC commands added for session, bash, queue and fork flows', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-commands-test-'))
  const executable = join(cwd, 'pi')
  const host = new PiHost(executable)
  try {
    await writeFile(executable, `#!${process.execPath}
const rl = require('node:readline').createInterface({input: process.stdin})
rl.on('line', line => {
  const { id, type } = JSON.parse(line)
  console.log(JSON.stringify({
    id, type: 'response', command: type, success: true, data: { sessionId: 'cmd', echo: type }
  }))
})
`, { mode: 0o700 })
    await host.start({ cwd })
    for (const command of [
      { type: 'clear_queue' },
      { type: 'set_steering_mode', mode: 'all' },
      { type: 'set_follow_up_mode', mode: 'one-at-a-time' },
      { type: 'set_auto_compaction', enabled: false },
      { type: 'set_auto_retry', enabled: true },
      { type: 'abort_retry' },
      { type: 'bash', command: 'echo hi', excludeFromContext: true },
      { type: 'abort_bash' },
      { type: 'get_fork_messages' },
      { type: 'fork', entryId: 'e1' },
      { type: 'clone' },
      { type: 'export_html' },
      { type: 'get_last_assistant_text' },
      { type: 'set_session_name', name: 'Renamed' }
    ]) {
      const response = await host.command(command)
      assert.equal(response.success, true, `expected ${command.type} to succeed`)
      assert.equal(response.data.echo, command.type)
    }
  } finally {
    await host.stop(false)
    await rm(cwd, { recursive: true, force: true })
  }
})

test('renameSessionFile appends a valid session_info entry readable by listProjectSessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-rename-test-'))
  const agentDir = join(root, 'agent')
  const projectDir = join(root, 'project')
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  try {
    await mkdir(projectDir, { recursive: true })
    const resolvedProject = await realpath(projectDir)
    const safePath = `--${resolvedProject.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
    const sessionDir = join(agentDir, 'sessions', safePath)
    await mkdir(sessionDir, { recursive: true })
    const sessionFile = join(sessionDir, '2026-11-25_test.jsonl')
    await writeFile(sessionFile, [
      JSON.stringify({ type: 'session', version: 3, id: 's1', timestamp: '2026-11-25T00:00:00.000Z', cwd: resolvedProject }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: '2026-11-25T00:00:01.000Z', message: { role: 'user', content: 'hello', timestamp: 1 } })
    ].join('\n') + '\n', 'utf8')

    process.env.PI_CODING_AGENT_DIR = agentDir
    renameSessionFile(resolvedProject, sessionFile, '新会话标题')

    const sessions = listProjectSessions(resolvedProject)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].name, '新会话标题')
    assert.equal(sessions[0].title, '新会话标题')

    const lines = (await readFile(sessionFile, 'utf8')).trim().split('\n')
    const appended = JSON.parse(lines.at(-1))
    assert.equal(appended.type, 'session_info')
    assert.equal(appended.parentId, 'm1')
    assert.equal(appended.name, '新会话标题')
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    await rm(root, { recursive: true, force: true })
  }
})
