import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildSshSpawnArgs } from '../src/main/pi-host.ts'
import { listSshHosts, parseSshConfigContent } from '../src/main/ssh.ts'
import { normalizeSshTargetInput } from '../src/shared/ssh-target.ts'

test('parseSshConfigContent extracts concrete host aliases, merges attributes, and skips wildcards', () => {
  const hosts = parseSshConfigContent(`
    # Global defaults
    Host *
      ServerAliveInterval 60

    Host win-wsl wsl-dev !*.internal
      HostName 100.64.0.1
      User fansicheng
      Port 2222

    Host mofu-225
      HostName 192.168.1.225
      User ubuntu

    Host taishan
      HostName taishan.example.com
  `)

  assert.deepEqual(hosts, [
    { name: 'win-wsl', hostName: '100.64.0.1', user: 'fansicheng', port: 2222, source: 'config' },
    { name: 'wsl-dev', hostName: '100.64.0.1', user: 'fansicheng', port: 2222, source: 'config' },
    { name: 'mofu-225', hostName: '192.168.1.225', user: 'ubuntu', port: undefined, source: 'config' },
    { name: 'taishan', hostName: 'taishan.example.com', user: undefined, port: undefined, source: 'config' }
  ])
})

test('listSshHosts follows Include globs in sshDir without crashing on missing files', async () => {
  const sshDir = await mkdtemp(join(tmpdir(), 'pi-ssh-test-'))
  try {
    await mkdir(join(sshDir, 'config.d'))
    await writeFile(join(sshDir, 'config'), 'Include config.d/*.conf\n\nHost main-box\n  User root\n')
    await writeFile(join(sshDir, 'config.d', 'dev.conf'), 'Host gpu-node\n  HostName 10.0.0.8\n')

    const hosts = listSshHosts(sshDir)
    assert.deepEqual(hosts.map((host) => host.name), ['gpu-node', 'main-box'])
  } finally {
    await rm(sshDir, { recursive: true, force: true })
  }
})

test('normalizeSshTargetInput parses host, port, and rejects unsafe option/shell injection', () => {
  assert.deepEqual(normalizeSshTargetInput('mofu-225'), { host: 'mofu-225', port: undefined, label: 'mofu-225' })
  assert.deepEqual(normalizeSshTargetInput('ssh -p 2222 ubuntu@10.0.0.5'), {
    host: 'ubuntu@10.0.0.5',
    port: 2222,
    label: 'ubuntu@10.0.0.5'
  })
  assert.deepEqual(normalizeSshTargetInput('ubuntu@10.0.0.5:2200'), {
    host: 'ubuntu@10.0.0.5',
    port: 2200,
    label: 'ubuntu@10.0.0.5'
  })

  assert.throws(() => normalizeSshTargetInput('-oProxyCommand=id'), /格式不正确/)
  assert.throws(() => normalizeSshTargetInput('host; rm -rf /'), /格式不正确/)
  assert.throws(() => normalizeSshTargetInput(''), /请输入 SSH 主机名/)
})

test('buildSshSpawnArgs wraps remote working directory safely for BatchMode ssh execution', () => {
  const args = buildSshSpawnArgs({
    host: 'mofu-225',
    port: 2222,
    remoteCwd: "~/my 'repo'"
  })

  assert.equal(args[0], '-T')
  assert.ok(args.includes('-p'))
  assert.ok(args.includes('2222'))
  assert.equal(args[args.length - 2], 'mofu-225')
  assert.match(args[args.length - 1], /^sh -lc '/)
  assert.ok(args[args.length - 1].includes('pi --mode rpc'))
})
