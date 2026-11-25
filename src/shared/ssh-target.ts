export interface ParsedSshTargetInput {
  host: string
  port?: number
  label: string
}

/**
 * 解析并校验用户输入的主机别名、user@host、host:port 或 `ssh -p <port> <host>` 命令，
 * 拦截控制字符、命令行选项注入和 shell 元字符。
 */
export function normalizeSshTargetInput(raw: string): ParsedSshTargetInput {
  let trimmed = raw.trim()
  if (!trimmed) throw new Error('请输入 SSH 主机名或 user@host 地址。')
  if (/[\r\n\0]/.test(trimmed)) throw new Error('SSH 主机地址包含无效控制字符。')

  let port: number | undefined
  if (/^ssh\s+/i.test(trimmed)) {
    const tokens = trimmed.slice(3).trim().split(/\s+/)
    let hostToken: string | undefined
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === '-p' && tokens[index + 1]) {
        const parsed = Number(tokens[index + 1])
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
          throw new Error('SSH 端口号无效。')
        }
        port = parsed
        index += 1
      } else if (token.startsWith('-')) {
        throw new Error(`暂不支持的参数：${token}，请直接输入主机别名或 user@host。`)
      } else {
        hostToken = token
      }
    }
    trimmed = hostToken ?? ''
  }

  const hostPortMatch = /^([^:\s]+):(\d{1,5})$/.exec(trimmed)
  if (hostPortMatch) {
    const parsed = Number(hostPortMatch[2])
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error('SSH 端口号无效。')
    }
    trimmed = hostPortMatch[1]
    port = port ?? parsed
  }

  if (!trimmed || trimmed.startsWith('-') || /[\s;|&$`<>\\'"()]/.test(trimmed)) {
    throw new Error('SSH 主机地址格式不正确，请输入如 my-server 或 user@host。')
  }

  return { host: trimmed, port, label: trimmed }
}
