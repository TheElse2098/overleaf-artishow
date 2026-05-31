import Docker from 'dockerode'
import Path from 'node:path'
import { promisify } from 'node:util'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { getLastProjectAccessTime } from './LastProjectAccess.js'

const dockerSettings = Settings.clsi?.docker ?? {}
const docker = new Docker({
  socketPath: dockerSettings.socketPath ?? '/var/run/docker.sock',
})

// containerName -> container mapping for kill()
const activeContainers = new Map()

function buildEnv(environment) {
  const merged = { HOME: '/tmp', CLSI: '1', ...dockerSettings.env, ...environment }
  return Object.entries(merged).map(([k, v]) => `${k}=${v}`)
}

function resolveCommand(command, directory) {
  return command.map(arg => arg.toString().replace('$COMPILE_DIR', directory))
}

const DockerRunner = {
  run(projectId, command, directory, image, timeout, environment, compileGroup, cwd, callback) {
    const resolvedCmd = resolveCommand(command, directory)
    const workDir = cwd ? Path.join(directory, cwd) : directory
    const containerName = `overleaf-compile-${projectId}-${Date.now()}`

    const containerOptions = {
      name: containerName,
      Image: image || dockerSettings.image || 'texlive/texlive:latest-full',
      Cmd: resolvedCmd,
      WorkingDir: workDir,
      Env: buildEnv(environment || {}),
      User: dockerSettings.user || 'root',
      HostConfig: {
        Binds: [`${directory}:${directory}`],
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

    logger.debug({ projectId, containerName, image: containerOptions.Image, resolvedCmd }, 'starting Docker compile')

    docker.createContainer(containerOptions, (err, container) => {
      if (err) {
        logger.error({ err, projectId, containerName }, 'error creating Docker container')
        return callback(err)
      }

      activeContainers.set(containerName, container)
      let stdout = ''

      container.start(err => {
        if (err) {
          activeContainers.delete(containerName)
          container.remove({ force: true }, () => {})
          logger.error({ err, projectId }, 'error starting Docker container')
          return callback(err)
        }

        // Attach to capture stdout+stderr
        container.attach(
          { stream: true, stdout: true, stderr: true },
          (err, stream) => {
            if (!err && stream) {
              const stdoutBuf = { write: data => { stdout += data.toString() } }
              const stderrBuf = { write: () => {} }
              container.modem.demuxStream(stream, stdoutBuf, stderrBuf)
            }
          }
        )

        const timeoutHandle = timeout
          ? setTimeout(() => {
              logger.warn({ projectId, containerName, timeout }, 'Docker compile timed out, killing container')
              container.kill(() => {})
            }, timeout)
          : null

        container.wait((err, data) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          activeContainers.delete(containerName)
          container.remove({ force: true }, () => {})

          if (err) {
            logger.error({ err, projectId }, 'error waiting for Docker container')
            return callback(err)
          }
          logger.debug({ projectId, exitCode: data.StatusCode }, 'Docker compile finished')
          callback(null, { stdout, exitCode: data.StatusCode })
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
    return true
  },

  stopContainerMonitor() {
    // no persistent monitor in this implementation
  },
}

DockerRunner.promises = {
  run: promisify(DockerRunner.run),
  kill: promisify(DockerRunner.kill),
}

export default DockerRunner
