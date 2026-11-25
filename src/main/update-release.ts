import type { UpdateStatus } from '../shared/types'

const GITHUB_REPOSITORY = 'mofu2003/pi-desktop'
export const RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`
export const LATEST_RELEASE_API =
  `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('Invalid release version')
  }
  const parts = version.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version')
  return parts
}

export function resolveUpdate(
  payload: unknown,
  currentVersion: string,
  architecture: string
): UpdateStatus {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid release')
  const { tag_name: tag, assets, draft, prerelease } = payload as Record<string, unknown>
  if (
    typeof tag !== 'string' ||
    !tag.startsWith('v') ||
    draft !== false ||
    prerelease !== false ||
    !Array.isArray(assets)
  ) {
    throw new Error('Invalid release')
  }

  const version = tag.slice(1)
  const latest = versionParts(version)
  const installed = versionParts(currentVersion)
  const difference = latest.findIndex((part, index) => part !== installed[index])
  if (difference === -1 || latest[difference] < installed[difference]) {
    return { status: 'current' }
  }

  const assetName = `Pi-${version}-${architecture}.dmg`
  const asset = assets.find((item) => item?.name === assetName && item?.state === 'uploaded')
  if (!asset) {
    return { status: 'unavailable', version }
  }

  const digest = typeof asset.digest === 'string' ? /^sha256:([a-f0-9]{64})$/i.exec(asset.digest)?.[1] : undefined
  return {
    status: 'available',
    version,
    downloadUrl: `${RELEASES_URL}/download/${tag}/${encodeURIComponent(assetName)}`,
    ...(digest ? { sha256: digest.toLowerCase() } : {}),
    ...(Number.isSafeInteger(asset.size) && asset.size > 0 ? { size: asset.size } : {})
  }
}
