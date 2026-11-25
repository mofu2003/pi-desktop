import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findSessionById, forkSessionInWorktree, moveSessionFile, readSessionMarkdown } from '../src/main/pi-host.ts'

test('session file operations preserve history, identifiers, and existing destination files', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-session-library-')))
  const previousAgent = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent')
  const source = join(root, 'source')
  const target = join(root, 'target')
  const directory = (cwd) => join(root, 'agent', 'sessions', `--${cwd.slice(1).replaceAll('/', '-')}--`)
  const fileName = '2026-11-25T00-00-00-000Z_session-id.jsonl'
  const oldPath = join(directory(source), fileName)
  const newPath = join(directory(target), fileName)

  try {
    mkdirSync(source)
    mkdirSync(target)
    mkdirSync(directory(source), { recursive: true })
    mkdirSync(directory(target), { recursive: true })
    const rows = [
      { type: 'session', version: 3, id: 'session-id', cwd: source },
      { type: 'message', id: 'first', parentId: null, message: { role: 'user', content: '问题' } },
      { type: 'message', id: 'abandoned', parentId: 'first',
        message: { role: 'assistant', content: [{ type: 'text', text: '弃用分支' }] } },
      { type: 'message', id: 'last', parentId: 'first', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: '不复制思考文本' }, { type: 'text', text: '答案' }
      ] } }
    ]
    const original = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
    writeFileSync(oldPath, original)
    writeFileSync(newPath, 'collision')
    assert.throws(() => moveSessionFile(source, oldPath, target), { code: 'EEXIST' })
    assert.equal(readFileSync(oldPath, 'utf8'), original)
    rmSync(newPath)

    const moved = moveSessionFile(source, oldPath, target)
    assert.equal(moved.id, 'session-id')
    assert.equal(moved.path, newPath)
    assert.equal(moved.cwd, target)
    assert.equal(existsSync(oldPath), false)
    assert.equal(findSessionById('session-id')?.path, newPath)
    assert.equal(readSessionMarkdown(target, newPath), '## 你\n\n问题\n\n## Pi\n\n答案')

    const git = (...args) => execFileSync('git', args, { cwd: target, stdio: 'pipe' })
    git('init')
    writeFileSync(join(target, 'fixture.txt'), 'checkout')
    git('add', 'fixture.txt')
    git('-c', 'user.name=Pi Test', '-c', 'user.email=pi@example.invalid', 'commit', '-m', 'Fixture')
    const fork = await forkSessionInWorktree(root, target, newPath)
    assert.notEqual(fork.session.id, moved.id)
    assert.equal(readFileSync(join(fork.project.path, 'fixture.txt'), 'utf8'), 'checkout')
    assert.equal(readSessionMarkdown(fork.project.path, fork.session.path), readSessionMarkdown(target, newPath))
    assert.equal(existsSync(newPath), true)
  } finally {
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgent
    rmSync(root, { recursive: true, force: true })
  }
})
