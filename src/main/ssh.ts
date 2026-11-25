import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { SshHostInfo } from '../shared/types'

interface ParsedBlock {
  patterns: string[]
  hostName?: string
  user?: string
  port?: number
}

function stripComment(line: string): string {
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === '#' && !inQuotes) return line.slice(0, index)
  }
  return line
}

function tokenizeDirective(line: string): [string, string] | null {
  const trimmed = stripComment(line).trim()
  if (!trimmed) return null
  const match = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.+)$/.exec(trimmed)
  if (!match) return null
  return [match[1].toLowerCase(), match[2].trim()]
}

function unquoteTokens(raw: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index]
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

function expandIncludePaths(pattern: string, sshDir: string): string[] {
  const expanded = pattern.startsWith('~/')
    ? join(homedir(), pattern.slice(2))
    : isAbsolute(pattern)
      ? pattern
      : resolve(sshDir, pattern)

  if (!expanded.includes('*') && !expanded.includes('?')) {
    return [expanded]
  }

  const parent = dirname(expanded)
  const filePattern = basename(expanded)
  const regex = new RegExp(
    `^${filePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  )
  try {
    return readdirSync(parent)
      .filter((entry) => regex.test(entry))
      .sort()
      .map((entry) => join(parent, entry))
  } catch {
    return []
  }
}

export function parseSshConfigContent(
  content: string,
  options: { sshDir?: string; readFile?: (path: string) => string | null } = {}
): SshHostInfo[] {
  const sshDir = options.sshDir ?? join(homedir(), '.ssh')
  const read = options.readFile ?? ((filePath: string) => {
    try {
      return statSync(filePath, { throwIfNoEntry: false })?.isFile() ? readFileSync(filePath, 'utf8') : null
    } catch {
      return null
    }
  })

  const visited = new Set<string>()
  const collected = new Map<string, SshHostInfo>()

  const parseText = (text: string): void => {
    const blocks: ParsedBlock[] = []
    let current: ParsedBlock | null = null

    for (const line of text.split(/\r?\n/)) {
      const directive = tokenizeDirective(line)
      if (!directive) continue
      const [key, value] = directive

      if (key === 'include') {
        for (const incPattern of unquoteTokens(value)) {
          for (const incPath of expandIncludePaths(incPattern, sshDir)) {
            if (visited.has(incPath)) continue
            visited.add(incPath)
            const incText = read(incPath)
            if (incText !== null) parseText(incText)
          }
        }
        continue
      }

      if (key === 'host') {
        current = { patterns: unquoteTokens(value) }
        blocks.push(current)
        continue
      }

      if (key === 'match') {
        current = null
        continue
      }

      if (!current) continue
      if (key === 'hostname') {
        current.hostName = unquoteTokens(value)[0]
      } else if (key === 'user') {
        current.user = unquoteTokens(value)[0]
      } else if (key === 'port') {
        const port = Number(unquoteTokens(value)[0])
        if (Number.isInteger(port) && port > 0 && port <= 65535) current.port = port
      }
    }

    for (const block of blocks) {
      for (const pattern of block.patterns) {
        if (!pattern || pattern.startsWith('!') || /[*?]/.test(pattern)) continue
        const existing = collected.get(pattern)
        if (!existing) {
          collected.set(pattern, {
            name: pattern,
            hostName: block.hostName,
            user: block.user,
            port: block.port,
            source: 'config'
          })
        } else {
          if (!existing.hostName && block.hostName) existing.hostName = block.hostName
          if (!existing.user && block.user) existing.user = block.user
          if (!existing.port && block.port) existing.port = block.port
        }
      }
    }
  }

  parseText(content)
  return [...collected.values()]
}

export function listSshHosts(sshDir = join(homedir(), '.ssh')): SshHostInfo[] {
  const configPath = join(sshDir, 'config')
  try {
    if (!statSync(configPath, { throwIfNoEntry: false })?.isFile()) return []
    const content = readFileSync(configPath, 'utf8')
    return parseSshConfigContent(content, { sshDir })
  } catch {
    return []
  }
}
