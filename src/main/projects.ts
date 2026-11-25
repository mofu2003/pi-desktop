import { mkdir, mkdtemp, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInfo } from '../shared/types'

export async function createProject(
  userData: string,
  name: string,
  sourceFolder?: string
): Promise<ProjectInfo> {
  const projectName = name.trim()
  if (!projectName) throw new Error('请输入项目名称。')

  if (sourceFolder) {
    const path = await realpath(sourceFolder).catch(() => null)
    if (!path || !(await stat(path).catch(() => null))?.isDirectory()) {
      throw new Error('源文件夹不存在，请重新选择。')
    }
    return { name: projectName, path }
  }

  const projectsDir = join(userData, 'projects')
  await mkdir(projectsDir, { recursive: true })
  const path = await mkdtemp(join(await realpath(projectsDir), 'project-'))
  return { name: projectName, path }
}
