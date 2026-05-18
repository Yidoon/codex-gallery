import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const packagePath = 'package.json'
const tauriConfigPath = 'src-tauri/tauri.conf.json'
const cargoTomlPath = 'src-tauri/Cargo.toml'
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/

const [command = 'check', value] = process.argv.slice(2).filter((arg) => arg !== '--')

function readVersions() {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
  const cargoToml = readFileSync(cargoTomlPath, 'utf8')
  const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1]

  if (!cargoVersion) {
    throw new Error(`Could not read package version from ${cargoTomlPath}`)
  }

  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriConfig.version,
    cargoVersion,
  }
}

function printVersions(tag) {
  const versions = readVersions()
  const tagVersion = tag ? tag.replace(/^v/, '') : undefined

  if (tag) {
    console.log(`Release tag:     ${tag}`)
    console.log(`Tag version:     ${tagVersion}`)
  }
  console.log(`package.json:    ${versions.packageVersion}`)
  console.log(`tauri.conf.json: ${versions.tauriVersion}`)
  console.log(`Cargo.toml:      ${versions.cargoVersion}`)

  return { ...versions, tagVersion }
}

function assertValidVersion(version) {
  if (!semverPattern.test(version)) {
    throw new Error(`Version must look like 1.0.0. Got: ${version}`)
  }
}

function assertVersionsMatch(tag) {
  if (tag && !/^v[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error('Release tag must look like v1.0.0.')
  }

  const versions = printVersions(tag)
  const expectedVersion = versions.tagVersion ?? versions.packageVersion
  assertValidVersion(expectedVersion)

  if (
    versions.packageVersion !== expectedVersion ||
    versions.tauriVersion !== expectedVersion ||
    versions.cargoVersion !== expectedVersion
  ) {
    throw new Error(
      'Release tag must match package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml versions.',
    )
  }
}

function bumpVersion(version, bumpKind) {
  const match = version.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/)
  if (!match) {
    throw new Error(`Can only auto-bump stable x.y.z versions. Got: ${version}`)
  }

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])

  if (bumpKind === 'major') {
    return `${major + 1}.0.0`
  }
  if (bumpKind === 'minor') {
    return `${major}.${minor + 1}.0`
  }
  if (bumpKind === 'patch') {
    return `${major}.${minor}.${patch + 1}`
  }

  throw new Error('Bump kind must be patch, minor, major, or an explicit x.y.z version.')
}

function writeVersion(version) {
  assertValidVersion(version)

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  packageJson.version = version
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
  tauriConfig.version = version
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`)

  const cargoToml = readFileSync(cargoTomlPath, 'utf8')
  writeFileSync(cargoTomlPath, cargoToml.replace(/^version = "([^"]+)"/m, `version = "${version}"`))
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function assertCleanWorkingTree() {
  const status = git(['status', '--porcelain'])
  if (status) {
    throw new Error('Working tree must be clean before creating a release tag.')
  }
}

function tagExists(tag) {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

function remoteTagExists(tag) {
  try {
    return git(['ls-remote', '--tags', 'origin', tag]) !== ''
  } catch {
    return false
  }
}

try {
  if (command === 'check') {
    assertVersionsMatch(value ?? process.env.GITHUB_REF_NAME)
  } else if (command === 'bump') {
    const currentVersion = readVersions().packageVersion
    const nextVersion = semverPattern.test(value ?? '') ? value : bumpVersion(currentVersion, value ?? 'patch')
    writeVersion(nextVersion)
    assertVersionsMatch()
  } else if (command === 'tag') {
    assertVersionsMatch()
    assertCleanWorkingTree()

    const tag = `v${readVersions().packageVersion}`
    if (tagExists(tag)) {
      throw new Error(`${tag} already exists locally.`)
    }
    if (remoteTagExists(tag)) {
      throw new Error(`${tag} already exists on origin.`)
    }

    git(['tag', '-a', tag, '-m', tag])
    console.log(`Created ${tag}`)
  } else {
    throw new Error('Usage: node scripts/release-version.mjs check [v1.0.0] | bump [patch|minor|major|1.0.0] | tag')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
