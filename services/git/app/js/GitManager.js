import simpleGit from 'simple-git'
import fs from 'fs-extra'
import crypto from 'node:crypto'
import sshpk from 'sshpk'
import path from 'node:path'


const DATA_PATH = '/var/lib/overleaf/data/git/'
const BANNED_FILES = ['output.aux', 'output.fdb_latexmk', 'output.fls', 'output.log', 'output.pdf', 'output.stdout', 'output.stderr', 'output.synctex.gz', '.project-sync-state']

function getGitForProject(projectId, userId) {
  const repoPath = DATA_PATH + projectId + '-' + userId  // middleware via le web 
  return simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'],
  })
}

export async function commit(projectId, userId, message) {
  const git = getGitForProject(projectId, userId)
  await git.addConfig('user.name', 'overleaf')
  await git.addConfig('user.email', 'overleaf@overleaf.com')
  await git.commit(message)
}


// Construit une URL HTTPS authentifiée par token
// tokenType 'github' → x-access-token, 'gitlab' → oauth2
function buildAuthenticatedUrl(remoteUrl, token, tokenType) {
  const username = tokenType === 'gitlab' ? 'oauth2' : 'x-access-token'
  const sshPattern = /^git@([^:]+):(.+\.git)$/
  const match = remoteUrl.match(sshPattern)
  if (match) {
    return `https://${username}:${token}@${match[1]}/${match[2]}`
  }
  try {
    const url = new URL(remoteUrl)
    url.username = username
    url.password = token
    return url.toString()
  } catch {
    return remoteUrl
  }
}


// Exécute fn() avec GIT_SSH_COMMAND défini dans process.env
// Contourne les validations simple-git sur GIT_SSH_COMMAND et core.sshCommand
async function withSshKey(userId, fn) {
  const key = await getKey(userId, 'private')
  const prev = process.env.GIT_SSH_COMMAND
  process.env.GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -i ${key}`
  try {
    return await fn()
  } finally {
    if (prev !== undefined) process.env.GIT_SSH_COMMAND = prev
    else delete process.env.GIT_SSH_COMMAND
  }
}


function convertPemToOpenSSH(pemKey) {
  try {
    return sshpk.parseKey(pemKey, 'pem').toString('ssh')
  } catch (error) {
    console.error('Error converting key:', error)
    return ''
  }
}

async function generateKeyPairAsync() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }, (err, publicKey, privateKey) => {
      if (err) reject(err)
      else resolve({ publicKey, privateKey })
    })
  })
}

async function makeKey(keyPath) {
  await fs.mkdir(keyPath)
  const { publicKey, privateKey } = await generateKeyPairAsync()
  await Promise.all([
    fs.writeFile(keyPath + '/public', publicKey, 'utf8'),
    fs.writeFile(keyPath + '/private', privateKey, 'utf8'),
  ])
  await fs.chmod(keyPath + '/private', 0o600)
}

async function getKey(userId, type) {
  const keyPath = DATA_PATH + 'keys/' + userId
  if (!fs.existsSync(keyPath + '/private')) {
    await makeKey(keyPath)
  }
  if (type === 'private') {
    return keyPath + '/private'           // ← le CHEMIN, pour `ssh -i`
  }
  const publicKeyPEM = await fs.readFile(keyPath + '/public', 'utf8')
  return convertPemToOpenSSH(publicKeyPEM)
}

// Choisit le remote + les credentials selon gitInfo, puis exécute fn(remote)
// - token dispo  → URL HTTPS authentifiée
// - sinon        → clé SSH, remote = 'origin'
async function withRemoteAuth(userId, gitInfo, fn) {
  if (gitInfo?.token && gitInfo?.remoteUrl) {
    const authUrl = buildAuthenticatedUrl(gitInfo.remoteUrl, gitInfo.token, gitInfo.tokenType)
    return fn(authUrl)
  }
  return withSshKey(userId, () => fn('origin'))
}

// Empêche git de convertir les fins de ligne (corruption des fichiers binaires)
async function disableBinaryConversion(repoPath) {
  await fs.ensureDir(path.join(repoPath, '.git', 'info'))
  await fs.writeFile(path.join(repoPath, '.git', 'info', 'attributes'), '* -text\n', 'utf8')
}

// Annule le merge en cours et retourne la liste des fichiers en conflit
async function abortMergeAndGetConflicts(git, knownConflicts) {
  let conflicted = [...knownConflicts]
  if (conflicted.length === 0) {
    try { conflicted = (await git.status()).conflicted } catch (_) {}
  }
  try { await git.merge(['--abort']) } catch (_) {}
  return conflicted
}

export async function push(projectId, userId, gitInfo) {
    const git = getGitForProject(projectId, userId)
    await withRemoteAuth(userId, gitInfo, remote =>
      git.push(remote, gitInfo?.branch || null)
    )
}


export async function pull(projectId, userId, gitInfo) {
    const git = getGitForProject(projectId, userId)
    const repoPath = DATA_PATH + projectId + '-' + userId

    //stash
    let stashed = false
    const status = await git.status()
    if (status.files.length > 0) {
        await git.stash(['push', '-u', '-m', 'overleaf-auto-stash-before-pull'])
        stashed = true
    }

    await disableBinaryConversion(repoPath)

    //pull

    const result = await withRemoteAuth(userId, gitInfo, remote =>
    git.pull(remote, gitInfo?.branch || null, { '--no-rebase': null })
    )

    //conflicts

    if (result.conflicts && result.conflicts.length > 0) {
        if (stashed) {
            try { await git.raw(['reset', '--hard', 'HEAD']); await git.stash(['pop']) } catch (_) {}
        }
        const conflicted = await abortMergeAndGetConflicts(git, result.conflicts)
        return { status: 'conflict', conflicts: conflicted }
    }

    //checkout HEAD
    
    await git.raw(['checkout', 'HEAD', '--', '.'])

    //pop stash

    let stashConflict = false
    if (stashed) {
        try {
            await git.stash(['pop'])
        } catch {
            stashConflict = true
            try { await git.raw(['reset', '--hard', 'HEAD']); await git.stash(['drop']) } catch (_) {}
        }
    }
    
    //del fichiers en rab
    for (const banned of BANNED_FILES) {
        const p = path.join(repoPath, banned)
        if (await fs.pathExists(p)) await fs.remove(p)
    }
    
    return { status: stashConflict ? 'stash-conflict' : 'ok' }


}


export async function add(projectId, userId, filePath, deleted) {
  const git = getGitForProject(projectId, userId)
  const repoPath = DATA_PATH + projectId + '-' + userId

  if (deleted) {
    const fullPath = path.join(repoPath, filePath)
    if (await fs.pathExists(fullPath)) await fs.remove(fullPath)
  }
  await git.add(filePath)
}
 