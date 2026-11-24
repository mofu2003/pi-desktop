import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { CustomizationDetail, CustomizationResource } from '../shared/types'

type Scope = CustomizationResource['scope']
export type LocatedCustomizationResource = CustomizationResource & { location: string }
type Resource = LocatedCustomizationResource

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return object(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`无法读取 ${basename(path)}，请检查文件格式和访问权限。`)
  }
}

function resource(
  kind: CustomizationResource['kind'], scope: Scope, name: string,
  location: string, description?: string
): Resource {
  const id = createHash('sha256').update(JSON.stringify([kind, scope, name, location])).digest('hex')
  return { id, kind, scope, name, location, description }
}

function configuredPaths(root: string, value: unknown): string[] {
  return array(value).flatMap((entry) => {
    if (typeof entry !== 'string' || !entry || /^[-!]|^builtin:/.test(entry)) return []
    const path = entry.startsWith('+') ? entry.slice(1) : entry
    if (!path || path.startsWith('builtin:')) return []
    return [path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(root, path)]
  })
}

async function skillMetadata(location: string): Promise<{ name: string; description?: string }> {
  const file = await open(location)
  try {
    const buffer = Buffer.alloc(8192)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const source = buffer.subarray(0, bytesRead).toString('utf8')
    const frontmatter = source.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
    const field = (name: string): string | undefined => {
      const match = frontmatter.match(new RegExp(`^${name}:[ \\t]*(.*)((?:\\r?\\n[ \\t]+[^\\r\\n]+)*)`, 'm'))
      if (!match) return undefined
      const value = /^[>|]/.test(match[1]) ? match[2].trim().replace(/\s+/g, ' ') : match[1].trim()
      return value.replace(/^(['"])(.*)\1$/, '$2') || undefined
    }
    const fallback = basename(location) === 'SKILL.md' ? basename(dirname(location)) : basename(location, '.md')
    return { name: field('name') ?? fallback, description: field('description') }
  } finally {
    await file.close()
  }
}

async function discoverSkills(paths: string[], scope: Scope): Promise<Resource[]> {
  const seen = new Set<string>()
  const results: Resource[] = []

  async function visit(path: string, allowStandalone: boolean): Promise<void> {
    try {
      const location = await realpath(path)
      if (seen.has(location)) return
      seen.add(location)
      const info = await stat(location)
      if (info.isDirectory()) {
        const entries = await readdir(location, { withFileTypes: true })
        await Promise.all(entries.filter((entry) =>
          !entry.name.startsWith('.') && entry.name !== 'node_modules' &&
          (entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'SKILL.md' ||
            (allowStandalone && extname(entry.name) === '.md'))
        ).map((entry) => visit(join(location, entry.name), allowStandalone && !entry.isDirectory())))
      } else if (info.isFile() && (basename(location) === 'SKILL.md' ||
        (allowStandalone && extname(location) === '.md'))) {
        const { name, description } = await skillMetadata(location)
        results.push(resource('skills', scope, name, location, description))
      }
    } catch {
      // A missing optional directory or broken symlink does not stop discovery.
    }
  }

  await Promise.all(paths.map((path) => visit(path, true)))
  return results
}

function packageName(source: string): string {
  if (source.startsWith('npm:')) return source.slice(4)
  const reference = source.replace(/^git:/, '')
  try {
    const url = new URL(reference)
    return basename(url.pathname.replace(/\/$/, ''), '.git') || url.hostname
  } catch {
    return basename(reference.split(/[?#]/, 1)[0].replace(/^.*@[^/:]+:/, '')) || '本地扩展包'
  }
}

async function discoverExtensions(root: string, settings: Record<string, unknown>, scope: Scope): Promise<Resource[]> {
  const settingsPath = join(root, 'settings.json')
  const packages = array(settings.packages).flatMap((entry) => {
    const source = typeof entry === 'string' ? entry : object(entry).source
    return typeof source === 'string' && source ? [
      resource('extensions', scope, packageName(source), settingsPath, '已配置的 Pi 扩展包')
    ] : []
  })
  const extensionsDir = join(root, 'extensions')
  const defaults = await readdir(extensionsDir).catch(() => [])
  const paths = [...defaults.filter((name) => !name.startsWith('.')).map((name) => join(extensionsDir, name)),
    ...configuredPaths(root, settings.extensions)]
  const standalone = await Promise.all(paths.map(async (path) => {
    try {
      const location = await realpath(path)
      const info = await stat(location)
      if (info.isDirectory()) {
        for (const name of ['index.ts', 'index.js']) {
          const entry = join(location, name)
          if ((await stat(entry).catch(() => undefined))?.isFile()) {
            return resource('extensions', scope, basename(location), entry, '本地扩展')
          }
        }
      } else if (info.isFile() && /\.(?:[cm]?js|ts)$/.test(location)) {
        return resource('extensions', scope, basename(location), location, '本地扩展')
      }
    } catch {
      // Skip missing entries.
    }
    return undefined
  }))
  return [...packages, ...standalone.filter((entry) => entry !== undefined)]
}

async function listScope(root: string, agentsSkills: string, scope: Scope): Promise<Resource[]> {
  const mcpPath = join(root, 'mcp.json')
  const [settings, mcp] = await Promise.all([readConfig(join(root, 'settings.json')), readConfig(mcpPath)])
  const [skills, extensions] = await Promise.all([
    discoverSkills([join(root, 'skills'), agentsSkills, ...configuredPaths(root, settings.skills)], scope),
    discoverExtensions(root, settings, scope)
  ])
  const connections = Object.entries(object(mcp.mcpServers)).map(([name, value]) => {
    const server = object(value)
    const transport = typeof server.url === 'string' ? 'HTTP'
      : typeof server.command === 'string' ? '本地进程' : '配置覆盖'
    const status = server.enabled === false ? '已停用' : '已配置'
    return resource('mcp', scope, name, mcpPath, `${transport} · ${status}`)
  })
  return [...skills, ...connections, ...extensions]
}

export async function listCustomizationResources(cwd?: string): Promise<Resource[]> {
  const home = homedir()
  const agent = process.env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent')
  const project = typeof cwd === 'string' && isAbsolute(cwd) ? cwd : undefined
  const scopes = await Promise.all([
    listScope(agent, join(home, '.agents', 'skills'), 'user'),
    project ? listScope(join(project, '.pi'), join(project, '.agents', 'skills'), 'project') : []
  ])
  return [...new Map(scopes.flat().map((entry) => [entry.id, entry])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
}

const previewExtensions = new Set(['.md', '.txt', '.js', '.ts', '.sh', '.py'])
const previewLimit = 256 * 1024

function canPreview(filename: string): boolean {
  return previewExtensions.has(extname(filename).toLowerCase())
}

async function listSkillFiles(entry: string): Promise<string[]> {
  if (basename(entry) !== 'SKILL.md') return [basename(entry)]

  const root = dirname(entry)
  const files = ['SKILL.md']
  async function walk(parent: string, depth: number): Promise<void> {
    if (depth === 0) return
    const entries = await readdir(join(root, parent), { withFileTypes: true })
    for (const child of entries) {
      if (files.length >= 100) return
      if (child.name.startsWith('.') || child.name === 'node_modules') continue
      const path = parent ? `${parent}/${child.name}` : child.name
      if (child.isDirectory()) await walk(path, depth - 1)
      else if (child.isFile() && path !== 'SKILL.md' && canPreview(path)) files.push(path)
    }
  }
  await walk('', 5)
  return [files[0], ...files.slice(1).sort((a, b) => a.localeCompare(b))]
}

function exposure(value: unknown): string | undefined {
  if (value === 'codemode-deferred') return 'codemode'
  if (value === 'codemode' || value === 'deferred' || value === 'direct' || value === 'hidden') {
    return value
  }
  return undefined
}

export async function describeCustomization(resource: Resource): Promise<CustomizationDetail> {
  if (resource.kind === 'skills') return { files: await listSkillFiles(resource.location) }
  if (resource.kind !== 'mcp') return { files: [] }

  const config = await readConfig(resource.location)
  const servers = object(config.mcpServers)
  if (!Object.hasOwn(servers, resource.name)) throw new Error('找不到此 MCP 配置，请刷新列表。')
  const server = object(servers[resource.name])
  const overrides = resource.scope === 'project' &&
    typeof server.command !== 'string' && typeof server.url !== 'string' && typeof server.type !== 'string'
  return {
    files: [],
    mcp: {
      description: typeof server.description === 'string' ? server.description : undefined,
      enabled: typeof server.enabled === 'boolean' ? server.enabled : overrides ? undefined : true,
      exposure: exposure(server.exposure) ?? (overrides ? undefined : 'codemode'),
      rules: Object.entries(object(server.toolExposure)).flatMap(([pattern, value]) => {
        const mode = exposure(value)
        return mode ? [{ pattern, exposure: mode }] : []
      })
    }
  }
}

export async function readSkillPreview(resource: Resource, file: string): Promise<string> {
  if (resource.kind !== 'skills' || typeof file !== 'string' || !canPreview(file) ||
    isAbsolute(file) || file.includes('\\') ||
    file.split('/').some((part) => !part || part.startsWith('.') || part === 'node_modules') ||
    (basename(resource.location) !== 'SKILL.md' && file !== basename(resource.location))) {
    throw new Error('无法预览此文件。')
  }

  const path = join(dirname(resource.location), file)
  // Detect a symlink introduced after the skill was enumerated.
  if (await realpath(path) !== path) throw new Error('无法预览符号链接指向的文件。')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > previewLimit) throw new Error('此文件不适合预览，请在访达中打开。')
    const buffer = Buffer.alloc(previewLimit + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > previewLimit) throw new Error('此文件过大，请在访达中打开。')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}
