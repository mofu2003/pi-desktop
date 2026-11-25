const { copyFile, mkdir, mkdtemp, readdir, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { Platform, build } = require('electron-builder')
const settings = require('../package.json')

async function packageMac() {
  const staging = await mkdtemp(join(tmpdir(), 'pi-desktop-package-'))
  const release = resolve(__dirname, '..', settings.build.directories.output)
  try {
    await build({
      targets: Platform.MAC.createTarget('dmg'),
      config: { directories: { output: staging } },
      publish: 'never'
    })

    const files = await readdir(staging)
    await mkdir(release, { recursive: true })
    for (const name of files.filter((file) => /\.dmg(?:\.blockmap)?$/.test(file))) {
      await copyFile(join(staging, name), join(release, name))
    }
    if (files.includes('latest-mac.yml')) {
      await copyFile(join(staging, 'latest-mac.yml'), join(release, 'latest-mac.yml'))
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

packageMac().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
