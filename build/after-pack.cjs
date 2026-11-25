const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { Arch } = require('builder-util')

const PI_VERSION = '1.6.0'
const PI_ASSET = 'pi-darwin-arm64.tar.gz'
const PI_SHA256 = '6429287b7ae98d726ec577815d14fd680e7c587e89ecc5153b4a145dc4adba33'

function bundlePi(appPath) {
  const destination = join(appPath, 'Contents', 'Resources', 'pi-runtime')
  const staging = mkdtempSync(join(tmpdir(), 'pi-runtime-'))
  const archive = process.env.PI_BUNDLE_ARCHIVE || join(staging, PI_ASSET)
  try {
    if (!process.env.PI_BUNDLE_ARCHIVE) {
      const url = `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}/${PI_ASSET}`
      execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '120', '-o', archive, url], {
        stdio: 'inherit'
      })
    }
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
    if (digest !== PI_SHA256) throw new Error(`Pi ${PI_VERSION} archive SHA-256 mismatch`)

    mkdirSync(destination, { recursive: true })
    execFileSync('tar', ['-xzf', archive, '-C', destination, '--strip-components', '1'])
    copyFileSync(join(__dirname, 'pi-runtime-LICENSE'), join(destination, 'LICENSE'))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (context.arch !== Arch.arm64) throw new Error('The bundled Pi runtime currently targets macOS arm64')

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  bundlePi(appPath)
  if (context.packager.platformSpecificBuildOptions.identity !== null) return

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' }
  )
}
