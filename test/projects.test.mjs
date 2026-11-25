import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createProject } from '../src/main/projects.ts'

test('creating a project from an existing folder preserves the folder and trims the display name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-project-test-'))
  try {
    const source = join(root, 'source')
    await mkdir(source)
    assert.deepEqual(await createProject(root, ' My Project ', source), {
      name: 'My Project', path: await realpath(source)
    })
    assert.deepEqual(await readdir(root), ['source'])
    await assert.rejects(createProject(root, 'Invalid source', join(root, 'removed')), /源文件夹不存在/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('name-only projects get separate workspaces even with the same name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-project-test-'))
  try {
    await assert.rejects(createProject(root, ' '), /请输入项目名称/)
    const first = await createProject(root, '../Project')
    const second = await createProject(root, '../Project')
    const projectsRoot = await realpath(join(root, 'projects'))
    assert.equal(first.name, '../Project')
    assert.ok(first.path.startsWith(projectsRoot + '/'))
    assert.ok(second.path.startsWith(projectsRoot + '/'))
    assert.notEqual(first.path, second.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
