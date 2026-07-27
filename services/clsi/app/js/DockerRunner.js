import Docker from 'dockerode'
import Path from 'node:path'
import { promisify } from 'node:util'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'

const dockerSettings = Settings.clsi?.docker ?? {}
const docker = new Docker({
  socketPath: dockerSettings.socketPath ?? '/var/run/docker.sock',
})

const activeContainers = new Map()

function buildEnv(environment) {
  const merged = { HOME: '/tmp', CLSI: '1', ...dockerSettings.env, ...environment }
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`)
}

function resolveCommand(command, directory) {
  return command.map(arg => arg.toString().replace('$COMPILE_DIR', directory))
}

// Sibling containers are created by the host Docker daemon, so bind mount sources
// must be host paths. SANDBOXED_COMPILES_HOST_DIR maps the container compile root
// to the equivalent host path.
function containerToHostPath(containerPath) {
  const containerRoot = '/var/lib/overleaf/data/compiles'
  const hostRoot =
    dockerSettings.sandboxedCompilesHostDir ||
    process.env.SANDBOXED_COMPILES_HOST_DIR
  if (hostRoot && containerPath.startsWith(containerRoot)) {
    return hostRoot + containerPath.slice(containerRoot.length)
  }
  return containerPath
}

const DockerRunner = {
  run(projectId, command, directory, image, timeout, environment, _compileGroup, cwd, callback) {
    const resolvedCmd = resolveCommand(command, directory)
    const workDir = cwd ? Path.join(directory, cwd) : directory
    const containerName = `overleaf-compile-${projectId}-${Date.now()}`
    const hostDirectory = containerToHostPath(directory)

    const containerOptions = {
      name: containerName,
      Image: image || dockerSettings.image || 'texlive/texlive:latest-full',
      Cmd: resolvedCmd,
      WorkingDir: workDir,
      Env: buildEnv(environment || {}),
      User: dockerSettings.user || 'root',
      HostConfig: {
        Binds: [`${hostDirectory}:${directory}`],
        AutoRemove: false,
        NetworkMode: 'none',
        Runtime: dockerSettings.runtime || undefined,
      },
    }

    if (dockerSettings.seccomp_profile) {
      containerOptions.HostConfig.SecurityOpt = [
        `seccomp=${dockerSettings.seccomp_profile}`,
      ]
    }

    logger.debug(
      { projectId, containerName, image: containerOptions.Image, resolvedCmd, hostDirectory },
      'starting Docker compile'
    )

    docker.createContainer(containerOptions, (err, container) => {
      if (err) {
        logger.error({ err, projectId, containerName }, 'error creating Docker container')
        return callback(err)
      }

      activeContainers.set(containerName, container)

      container.start(err => {
        if (err) {
          activeContainers.delete(containerName)
          container.remove({ force: true }, () => {})
          logger.error({ err, projectId }, 'error starting Docker container')
          return callback(err)
        }

        const timeoutHandle = timeout
          ? setTimeout(() => {
              logger.warn({ projectId, containerName, timeout }, 'Docker compile timed out, killing container')
              container.kill(() => {})
            }, timeout)
          : null

        container.wait((waitErr, data) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          activeContainers.delete(containerName)

          if (waitErr) {
            container.remove({ force: true }, () => {})
            logger.error({ err: waitErr, projectId }, 'error waiting for Docker container')
            return callback(waitErr)
          }

          // container.logs({ follow: false }) returns a Buffer (Docker multiplexed format),
          // not a stream. Parse the 8-byte frame headers manually: [type(1), pad(3), size(4BE)].
          container.logs({ stdout: true, stderr: false, follow: false }, (logErr, logData) => {
            container.remove({ force: true }, () => {})
            let stdout = ''
            if (!logErr && logData) {
              const buf = Buffer.isBuffer(logData) ? logData : Buffer.from(String(logData))
              let i = 0
              while (i + 8 <= buf.length) {
                const type = buf[i]
                const size = buf.readUInt32BE(i + 4)
                if (i + 8 + size > buf.length) break
                if (type === 1) stdout += buf.slice(i + 8, i + 8 + size).toString()
                i += 8 + size
              }
            }
            logger.debug({ projectId, exitCode: data.StatusCode }, 'Docker compile finished')
            callback(null, { stdout, exitCode: data.StatusCode })
          })
        })
      })
    })

    return containerName
  },

  kill(containerName, callback) {
    if (!callback) callback = () => {}
    const container =
      activeContainers.get(containerName) ?? docker.getContainer(containerName)
    container.kill(err => {
      if (
        err &&
        (err.statusCode === 404 ||
          (err.message && err.message.includes('is not running')))
      ) {
        return callback()
      }
      callback(err || null)
    })
  },

  canRunSyncTeXInOutputDir() {
    // This runner bind-mounts the compile dir 1:1 at its real path and only
    // remaps host paths under the compiles root (see containerToHostPath).
    // The output build dir lives under a different root that we do not remap,
    // so synctex must run in the compile dir, where output.synctex.gz and
    // output.pdf still live (latexmk wrote them there via -outdir=$COMPILE_DIR).
    return false
  },

  stopContainerMonitor() {},
}

DockerRunner.promises = {
  run: promisify(DockerRunner.run),
  kill: promisify(DockerRunner.kill),
}

export default DockerRunner
