import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { replaceMacApp, stageMacUpdate } from '../src/main/mac-update.ts'

test('rejects an altered installer before staging it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-update-test-'))
  const appPath = join(directory, 'Pi.app')
  try {
    await mkdir(appPath)
    const update = { version: '0.5.11', downloadUrl: 'https://example.invalid/Pi.dmg', sha256: '0'.repeat(64) }
    await assert.rejects(stageMacUpdate(update, appPath, async () => new Response('invalid data'), () => {}),
      /安装包校验失败/)
    assert.deepEqual(await readdir(directory), ['Pi.app'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('restores the original bundle if restart scheduling fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-update-replace-test-'))
  const appPath = join(directory, 'Pi.app')
  const staging = join(directory, '.pi-update-staging')
  const stagedPath = join(staging, 'Pi.app')
  const update = { directory: staging, appPath, stagedPath }
  try {
    await mkdir(appPath)
    await mkdir(stagedPath, { recursive: true })
    await writeFile(join(appPath, 'version'), 'old')
    await writeFile(join(stagedPath, 'version'), 'new')
    assert.throws(() => replaceMacApp(update, () => { throw new Error('could not restart') }), /could not restart/)
    assert.equal(await readFile(join(appPath, 'version'), 'utf8'), 'old')
    replaceMacApp(update, () => {})
    assert.equal(await readFile(join(appPath, 'version'), 'utf8'), 'new')
    assert.equal(await readFile(join(staging, 'previous.app', 'version'), 'utf8'), 'old')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
