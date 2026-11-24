const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (
    context.electronPlatformName !== 'darwin' ||
    context.packager.platformSpecificBuildOptions.identity !== null
  ) {
    return
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' }
  )
}
