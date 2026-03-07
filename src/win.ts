import * as main from './main.js'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'

export async function run(): Promise<void> {
  const verboseLoggingEnabled = core.getBooleanInput('verbose')
  try {
    await installCLI(verboseLoggingEnabled)
    await installServer(verboseLoggingEnabled)
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

function logOutputLine(
  output: Buffer,
  verboseLoggingEnabled: boolean,
  logger: (line: string) => void
): void {
  const outputLines = output.toString().split(/\r?\n/)
  for (const outputLine of outputLines) {
    const normalizedOutputLine = outputLine.trim()
    if (normalizedOutputLine === '') {
      continue
    }

    if (verboseLoggingEnabled) {
      logger(normalizedOutputLine)
    } else {
      core.debug(normalizedOutputLine)
    }
  }
}

async function checkOutput(
  cmd: string,
  args: string[] | undefined,
  verboseLoggingEnabled: boolean
): Promise<string> {
  let out = ''

  const options = {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        out += data.toString()
        logOutputLine(data, verboseLoggingEnabled, core.info)
      },
      stderr: (data: Buffer) => {
        logOutputLine(data, verboseLoggingEnabled, core.warning)
      }
    }
  }

  await exec.exec(cmd, args, options)
  return out.trim()
}

async function getBaseDist(verboseLoggingEnabled: boolean): Promise<string> {
  const arch = os.arch()
  const platform = (
    await checkOutput('wsl uname', undefined, verboseLoggingEnabled)
  ).toLocaleLowerCase()

  return main.getBaseDist(arch, platform, 'musl')
}

async function installCLI(verboseLoggingEnabled: boolean): Promise<void> {
  const requestedCLIVersion = core.getInput('cli-version')
  const arch = os.arch()
  const includeCliPrereleases = true
  let cliVersionRange = '*'
  let dist = await getBaseDist(verboseLoggingEnabled)

  if (requestedCLIVersion === 'nightly') {
    dist += '.nightly'
  } else if (requestedCLIVersion !== 'stable') {
    cliVersionRange = requestedCLIVersion
  }

  const versionMap = await main.getVersionMap(dist)
  const matchingVer = await main.getMatchingVer(
    versionMap,
    cliVersionRange,
    includeCliPrereleases
  )

  const cliPkg = versionMap.get(matchingVer)!
  const downloadUrl = new URL(cliPkg.installref, main.PKG_ROOT).href

  core.info(`Downloading gel-cli ${matchingVer} - ${arch} from ${downloadUrl}`)

  await checkOutput(
    'wsl',
    ['curl', '--fail', '--output', '/usr/bin/gel', downloadUrl],
    verboseLoggingEnabled
  )
  await checkOutput(
    'wsl chmod +x /usr/bin/gel',
    undefined,
    verboseLoggingEnabled
  )
  // Compatibility
  await checkOutput(
    'wsl ln -s gel /usr/bin/edgedb',
    undefined,
    verboseLoggingEnabled
  )
}

async function installServer(verboseLoggingEnabled: boolean): Promise<void> {
  const requestedVersion = core.getInput('server-version')

  const args = []

  if (requestedVersion === 'nightly') {
    args.push('--nightly')
  } else if (requestedVersion !== '' && requestedVersion !== 'stable') {
    args.push('--version')
    args.push(requestedVersion)
  }

  await checkOutput(
    'wsl',
    ['gel', 'server', 'install'].concat(args),
    verboseLoggingEnabled
  )

  if (args.length === 0) {
    args.push('--latest')
  }
  const bin = (
    await checkOutput(
      'wsl',
      ['gel', 'server', 'info', '--bin-path'].concat(args),
      verboseLoggingEnabled
    )
  ).trim()

  if (bin === '') {
    throw Error('could not find gel-server bin')
  }

  const instDir = path.dirname(path.dirname(bin))
  const binName = path.basename(bin)

  await checkOutput(
    'wsl',
    ['cp', '-a', instDir, '/opt/gel'],
    verboseLoggingEnabled
  )

  await checkOutput(
    'wsl',
    ['ln', '-s', '/opt/gel/bin/' + binName, '/usr/bin/' + binName],
    verboseLoggingEnabled
  )

  if (binName != 'gel-server') {
    await checkOutput(
      'wsl',
      ['ln', '-s', '/opt/gel/bin/' + binName, '/usr/bin/gel-server'],
      verboseLoggingEnabled
    )
  }
}
