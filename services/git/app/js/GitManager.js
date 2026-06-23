import simpleGit from 'simple-git'
import fs from 'fs-extra'
import crypto from 'node:crypto'
import sshpk from 'sshpk'
import path from 'node:path'


const DATA_PATH = '/var/lib/overleaf/data/git/'
const OUTPUT_PATH = '/var/lib/overleaf/data/compiles/'
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

export async function checkout(projectId, userId, ref, gitInfo) {
  const git = getGitForProject(projectId, userId)
  const repoPath = DATA_PATH + projectId + '-' + userId

  // Récupérer les refs distantes (auth token ou clé SSH)
  await withRemoteAuth(userId, gitInfo, remote => git.fetch(remote))

  // Le working tree contient des modifications non commitées synchronisées depuis
  // l'éditeur (via gitUpdate) qui bloqueraient le changement de branche. On les écarte :
  // le contenu de l'éditeur reste dans Mongo, le working tree sera reconstruit ensuite.
  await git.raw(['reset', '--hard', 'HEAD'])
  await git.raw(['clean', '-fd'])

  if (ref.startsWith('origin/')) {
    // Cible = branche distante → checkout/crée la branche locale correspondante
    const localBranch = ref.slice('origin/'.length)
    const localBranches = await git.branchLocal()
    if (localBranches.all.includes(localBranch)) {
      await git.checkout(localBranch)
      // S'aligner sur l'état distant (la branche locale peut être périmée)
      await git.raw(['reset', '--hard', ref])
    } else {
      await git.checkout(['-b', localBranch, ref])
    }
  } else {
    // Cible = commit (ou réf locale) → checkout direct ; pour un commit, HEAD détaché
    await git.checkout([ref])
  }

  // Réappliquer les attributs binaires puis ré-extraire pour éviter la corruption des binaires
  await disableBinaryConversion(repoPath)
  await git.raw(['checkout', 'HEAD', '--', '.'])
}

// Rollback DESTRUCTIF : déplace la branche courante sur un commit (reset --hard)
// et nettoie le working tree. Les commits postérieurs sont abandonnés.
export async function rollback(projectId, userId, commitHash) {
  const git = getGitForProject(projectId, userId)

  // Nettoyer le hash (tolère les anciens formats "hash|message" ou "hash date auteur")
  let cleanHash = commitHash.trim()
  if (cleanHash.includes('|')) cleanHash = cleanHash.split('|')[0]
  cleanHash = cleanHash.split(/\s+/)[0]

  if (!/^[a-f0-9]{4,40}$/i.test(cleanHash)) {
    throw new Error(`Commit hash invalide : ${commitHash}`)
  }

  // Vérifier que le commit existe (lève une erreur sinon)
  await git.show([cleanHash, '--format=format:', '--name-only'])

  // Revenir à ce commit et nettoyer les fichiers non suivis
  await git.reset(['--hard', cleanHash])
  await git.clean('f')
}

// Crée une nouvelle branche locale à partir de HEAD et la pousse sur le remote.
export async function createBranch(projectId, userId, newBranchName, gitInfo) {
  const git = getGitForProject(projectId, userId)
  await git.checkoutLocalBranch(newBranchName)
  await withRemoteAuth(userId, gitInfo, remote =>
    git.push(remote, newBranchName, ['--set-upstream'])
  )
}

export async function getStaged(projectId, userId) {
  const git = getGitForProject(projectId, userId)
  const status = await git.status()
  return status.staged
}

export async function getCommitHistory(projectId, userId, limit = 10) {
  const git = getGitForProject(projectId, userId)
  const log = await git.log([`-${limit}`])
  return log.all.map(c => ({
    hash: c.hash,
    message: c.message,
    date: c.date,
    author: c.author_name || 'Unknown',
  }))
}

export async function getBranches(projectId, userId, gitInfo) {
  const git = getGitForProject(projectId, userId)
  return withRemoteAuth(userId, gitInfo, async remote => {
    await git.fetch(remote)
    const branches = await git.branch(['-r'])
    return branches.all
  })
}

export async function getCurrentBranch(projectId, userId, gitInfo) {
  const git = getGitForProject(projectId, userId)
  return withRemoteAuth(userId, gitInfo, async remote => {
    await git.fetch(remote)
    const stat = await git.status()
    return `origin/${stat.current}`
  })
}

// Parcourt compiles/ et retourne les fichiers absents du working tree git et non suivis
async function scanCompilesDirForNewFiles(compilesDir, gitDir, trackedSet, gitStatusSet) {
  const result = []
  async function recurse(dir) {
    let items
    try { items = await fs.readdir(dir) } catch (_) { return }
    for (const item of items) {
      if (item === '.git') continue
      const fullPath = path.join(dir, item)
      let stat
      try { stat = await fs.stat(fullPath) } catch (_) { continue }
      const relPath = path.relative(compilesDir, fullPath).replace(/\\/g, '/')
      if (stat.isDirectory()) {
        await recurse(fullPath)
      } else {
        if (BANNED_FILES.includes(item)) continue
        if (trackedSet.has(relPath) || gitStatusSet.has(relPath)) continue
        const gitFilePath = path.join(gitDir, relPath)
        if (!(await fs.pathExists(gitFilePath))) result.push(relPath)
      }
    }
  }
  await recurse(compilesDir)
  return result
}

// Partie GIT du "non indexé" : fichiers modifiés/non suivis + nouveaux fichiers de compiles/.
// Renvoie aussi la liste des fichiers suivis, pour que web filtre les entités Overleaf.
export async function notStaged(projectId, userId) {
  const git = getGitForProject(projectId, userId)
  const gitDir = DATA_PATH + projectId + '-' + userId
  const compilesDir = OUTPUT_PATH + projectId + '-' + userId

  const status = await git.status(['-uall'])
  const modifiedFiles = status.files.filter(f => f.working_dir !== ' ' && f.working_dir !== 'D' && f.index === ' ').map(f => f.path)
  const untrackedFiles = status.files.filter(f => f.working_dir === '?' && f.index === '?').map(f => f.path)
  const gitStatusSet = new Set([...modifiedFiles, ...untrackedFiles])

  let tracked = []
  try {
    const result = await git.raw(['ls-files'])
    tracked = result.split('\n').filter(f => f.trim())
  } catch (_) {}
  const trackedSet = new Set(tracked)

  let overleafOnlyFiles = []
  if (await fs.pathExists(compilesDir)) {
    overleafOnlyFiles = await scanCompilesDirForNewFiles(compilesDir, gitDir, trackedSet, gitStatusSet)
  }

  return { notStaged: [...modifiedFiles, ...untrackedFiles, ...overleafOnlyFiles], tracked }
}

export async function gitClone(projectId, ownerId, link, branch, token, tokenType) {
  const cloneOptions = ['--no-checkout']
  const localGit = getGitForProject(projectId, ownerId)

  if (branch) cloneOptions.push('--branch', branch)
  if (token) {
    const authUrl = buildAuthenticatedUrl(link, token, tokenType)
    try {
      await simpleGit({ baseDir: dataPath, config: ['core.autocrlf=false', 'core.eol=lf'] }).clone(authUrl, repoPath, cloneOptions)
      console.log("Repository cloned via HTTPS token (no checkout) successfully!")
    } catch (error) {
      console.error('Error when cloning (token):', error)
      throw error
    }
  } else {
    const key = await getKey(ownerId, 'private')
    const prevSSH = process.env.GIT_SSH_COMMAND
    process.env.GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -i ${key}`
    try {
      await simpleGit({ baseDir: dataPath, config: ['core.autocrlf=false', 'core.eol=lf'] }).clone(link, repoPath, cloneOptions)
      console.log("Repository cloned via SSH (no checkout) successfully!")
    } catch (error) {
      console.error('Error when cloning (SSH):', error)
      throw error
    } finally {
      if (prevSSH !== undefined) process.env.GIT_SSH_COMMAND = prevSSH
      else delete process.env.GIT_SSH_COMMAND
    }
  }
  
  try {
    await localGit.raw(['checkout', 'HEAD', '--', '.'])
    console.log("Initial checkout done with binary attributes applied")
  } catch (checkoutErr) {
    console.error("Initial checkout failed:", checkoutErr.message)
    throw checkoutErr
  }
}
