import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveUpdate, RELEASES_URL } from '../src/main/update-release.ts'

test('reads and validates the GitHub digest for in-app installation', () => {
  const digest = 'a'.repeat(64)
  const asset = { ...release.assets[0], digest: 'sha256:' + digest, size: 173584019 }
  assert.equal(resolveUpdate({ ...release, assets: [asset] }, '0.1.9', 'arm64').sha256, digest)
  assert.equal(resolveUpdate({ ...release, assets: [{ ...asset, digest: 'bad' }] }, '0.1.9', 'arm64').sha256,
    undefined)
})

const release = {
  tag_name: 'v0.1.12',
  draft: false,
  prerelease: false,
  assets: [{ name: 'Pi-0.1.12-arm64.dmg', state: 'uploaded' }]
}

test('offers a newer stable release with a matching macOS installer', () => {
  assert.deepEqual(resolveUpdate(release, '0.1.9', 'arm64'), {
    status: 'available',
    version: '0.1.12',
    downloadUrl: `${RELEASES_URL}/download/v0.1.12/Pi-0.1.12-arm64.dmg`
  })
})

test('does not offer the current version or a downgrade', () => {
  assert.deepEqual(resolveUpdate(release, '0.1.12', 'arm64'), { status: 'current' })
  assert.deepEqual(resolveUpdate(release, '0.2.0', 'arm64'), { status: 'current' })
})

test('requires a finished installer for the running architecture', () => {
  assert.deepEqual(resolveUpdate(release, '0.1.9', 'x64'), { status: 'unavailable', version: '0.1.12' })
  const uploading = { ...release, assets: [{ ...release.assets[0], state: 'starter' }] }
  assert.deepEqual(resolveUpdate(uploading, '0.1.9', 'arm64'), { status: 'unavailable', version: '0.1.12' })
})

test('rejects drafts, prereleases and malformed version tags', () => {
  for (const invalid of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: 'v0.1.12-beta.1' },
    { ...release, tag_name: 'v0.1.12/../other' },
    null
  ]) {
    assert.throws(() => resolveUpdate(invalid, '0.1.9', 'arm64'))
  }
})

test('constructs the download link from the fixed repository', () => {
  const asset = { ...release.assets[0], browser_download_url: 'https://example.invalid/install.dmg' }
  const result = resolveUpdate({ ...release, assets: [asset] }, '0.1.9', 'arm64')
  assert.equal(result.downloadUrl, `${RELEASES_URL}/download/v0.1.12/Pi-0.1.12-arm64.dmg`)
})
