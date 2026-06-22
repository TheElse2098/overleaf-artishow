import simpleGit from 'simple-git'
import fs from 'fs-extra'
import crypto from 'node:crypto'
import sshpk from 'sshpk'


const DATA_PATH = '/var/lib/overleaf/data/git/'

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

export async function push(projectId, userId, gitInfo) {
    const git = getGitForProject(projectId, userId)
    if (gitInfo?.token && gitInfo?.remoteUrl) {
        const authUrl = buildAuthenticatedUrl(gitInfo.remoteUrl, gitInfo.token, gitInfo.tokenType)
        await git.push(authUrl, gitInfo.branch || null)
    } else {
        await withSshKey(userId, () => git.push('origin', gitInfo?.branch || null))
    }
}
