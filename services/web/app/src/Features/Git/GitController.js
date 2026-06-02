//GitController.js
const path = require('path')
const fs = require('fs-extra')
const dataPath = "/var/lib/overleaf/data/git/"
const outputPath = "/var/lib/overleaf/data/compiles/"
const uploadsPath = "/var/lib/overleaf/tmp/uploads/"
const clsiCachePath = "/var/lib/overleaf/data/cache/"
const simpleGit = require('simple-git')
const EditorController = require('../Editor/EditorController.mjs').default
const HistoryManager = require('../History/HistoryManager.mjs').default
const ProjectEntityHandler = require('../Project/ProjectEntityHandler.mjs').default
const CompileManager = require('../Compile/CompileManager.mjs').default
const ClsiCookieManager = require('../Compile/ClsiCookieManager.mjs').default
const Errors = require('../Errors/Errors')
const HttpErrorHandler = require('../Errors/HttpErrorHandler.mjs').default
const crypto = require('crypto')
const sshpk = require('sshpk')
const { Project } = require('../../models/Project.mjs')

const gitOptions = {
  baseDir: dataPath,
  privateKey: ""
}
const bannedFiles = ['output.aux', 'output.fdb_latexmk', 'output.fls', 'output.log', 'output.pdf', 'output.stdout', 'output.stdout', 'output.stderr', 'output.synctex.gz', 'output.synctex(busy)', '.project-sync-state'];

var git = simpleGit(gitOptions)

function getRootId(projectId) {
  let decimalValue = BigInt('0x' + projectId)
  let decrementedValue = decimalValue - BigInt(1)
  let decrementedHexString = decrementedValue.toString(16)
  return decrementedHexString
}
function getGitForProject(projectId, userId) {
  const repoPath = dataPath + projectId + "-" + userId;
  return simpleGit({ baseDir: repoPath, config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'] });
}

async function createFolder(projectId, ownerId, parentId, name) {
  const doc = await EditorController.promises.addFolder(
    projectId,
    parentId,
    name,
    'editor',
    ownerId
  )
 return doc._id.toString()
}

async function compileProject(projectId, userId)
{
  console.log('Triggering compilation...');
  const compilePromise = new Promise((resolve, reject) => {
	  let handler = setTimeout(() => {
          reject(new Error('Compiler timed out'));
          handler = null;
        }, 10000); // 10-second timeout

  CompileManager.compile(
          projectId,
          userId,
          {}, // Add any options if needed
          function (error, status) {
            if (handler) {
              clearTimeout(handler);
            }
            if (error) {
              reject(error);
            } else if (status === 'success') {
              resolve('Compilation successful');
            } else {
              reject(new Error(`Compilation failed: ${status}`));
            }
          }
        );
      });

  const compileResult = await compilePromise;
  console.log(compileResult);

}
async function createFile(projectId, ownerId, parentId, name, content) {
  try {
    const doc = await EditorController.promises.addDoc(
      projectId,
      parentId,
      name,
      content,
      'editor',
      ownerId
    )
    return doc._id.toString()
  } catch (err) {
    console.error(err.message)
    return "0"
  }
}

async function createBinaryFile(projectId, ownerId, parentId, name, fsPath) {
  try {
    const stat = await fs.stat(fsPath)
    console.log(`Uploading binary file: ${name}, size=${stat.size} bytes, path=${fsPath}`)
    if (stat.size === 0) {
      console.error(`Binary file is empty, skipping: ${name}`)
      return '0'
    }
    const file = await EditorController.promises.addFile(
      projectId,
      parentId,
      name,
      fsPath,
      null,
      'editor',
      ownerId
    )
    console.log(`Binary file uploaded successfully: ${name}, fileId=${file._id}`)
    return file._id.toString()
  } catch (err) {
    console.error(`Error adding binary file ${name}:`, err.message)
    return '0'
  }
}

const textExtensions = ['.tex', '.bib', '.txt', '.md', '.cls', '.sty', '.def', '.cfg', '.ist', '.bst', '.tikz', '.pgf']

async function resetDatabase(projectId, userId, projectPath) {
  const items = await fs.readdir(projectPath)

  await Promise.all(
    items
      .filter(item => !bannedFiles.includes(item))
      .map(item =>
        new Promise(resolve => {
          EditorController.deleteEntityWithPath(projectId, item, 'unknown', userId, () => resolve())
        })
      )
  )
}

// Used only for rollback: clears then rebuilds from scratch (entities get new IDs)
async function _buildProjectFromScratch(currentPath, projectId, ownerId, parentId) {
  const items = await fs.readdir(currentPath)
  for (const item of items) {
    const itemPath = path.join(currentPath, item)
    const stat = await fs.stat(itemPath)
    if (stat.isDirectory() && item !== '.git') {
      const newFolderId = await createFolder(projectId, ownerId, parentId, item)
      await _buildProjectFromScratch(itemPath, projectId, ownerId, newFolderId)
    } else if (stat.isFile()) {
      if (bannedFiles.includes(item)) continue
      const ext = path.extname(item).toLowerCase()
      if (textExtensions.includes(ext)) {
        const data = fs.readFileSync(itemPath, 'utf8')
        const lines = data.split(/\r?\n/)
        await createFile(projectId, ownerId, parentId, item, lines)
      } else {
        try { await fs.chmod(itemPath, 0o644) } catch (e) {}
        await createBinaryFile(projectId, ownerId, parentId, item, itemPath)
      }
    }
  }
}

// Used for pull/clone: upserts entities in place so open documents keep their IDs
async function _buildProjectWithUpsert(currentPath, gitRootPath, projectId, ownerId) {
  const items = await fs.readdir(currentPath)
  for (const item of items) {
    if (item === '.git') continue
    const itemPath = path.join(currentPath, item)
    const stat = await fs.stat(itemPath)
    if (stat.isDirectory()) {
      await _buildProjectWithUpsert(itemPath, gitRootPath, projectId, ownerId)
      continue
    }
    if (!stat.isFile() || bannedFiles.includes(item)) continue

    const relPath = '/' + path.relative(gitRootPath, itemPath).replace(/\\/g, '/')
    const ext = path.extname(item).toLowerCase()
    if (textExtensions.includes(ext)) {
      try {
        const data = fs.readFileSync(itemPath, 'utf8')
        const lines = data.split(/\r?\n/)
        await EditorController.promises.upsertDocWithPath(projectId, relPath, lines, 'editor', ownerId)
        console.log(`Upserted doc: ${relPath}`)
      } catch (err) {
        console.error(`Error upserting doc ${relPath}:`, err.message)
      }
    } else {
      try { await fs.chmod(itemPath, 0o644) } catch (e) {}
      const fileStat = await fs.stat(itemPath)
      console.log(`Upserting binary: ${relPath}, size=${fileStat.size}`)
      // Copier vers le dossier uploads standard avant l'upsert pour reproduire exactement
      // le chemin d'un upload manuel (qui fonctionne). Un upload direct depuis le dossier git
      // peut échouer silencieusement au niveau du filestore selon les permissions/contexte.
      const tmpName = `${Date.now()}_${path.basename(itemPath)}`
      const tmpPath = path.join(uploadsPath, tmpName)
      try {
        await fs.ensureDir(uploadsPath)
        await fs.copy(itemPath, tmpPath)
        await EditorController.promises.upsertFileWithPath(projectId, relPath, tmpPath, null, 'editor', ownerId)
        console.log(`Upserted binary: ${relPath}`)
      } catch (err) {
        console.error(`Error upserting file ${relPath}:`, err.message)
      } finally {
        try { await fs.remove(tmpPath) } catch (_) {}
      }
    }
  }
}

async function buildProject(currentPath, projectId, ownerId, parentId, rollbacked = false) {
  if (rollbacked) {
    await resetDatabase(projectId, ownerId, outputPath + '/' + projectId + '-' + ownerId)
    await _buildProjectFromScratch(currentPath, projectId, ownerId, parentId)
  } else {
    await _buildProjectWithUpsert(currentPath, currentPath, projectId, ownerId)
  }
}

// Resynchronise l'historique Overleaf avec l'état réel du projet après un pull/clone git.
// Séquence en deux étapes pour gérer les projets dont l'état project-history est corrompu :
//   1. Supprimer l'état project-history (file Redis, record d'erreur MongoDB, état de resync)
//   2. Déclencher une resynchronisation forcée pour reconstruire l'historique depuis la structure actuelle
// Appelé en arrière-plan pour ne pas bloquer la réponse HTTP.
async function resyncHistory(projectId) {
  try {
    // Effacer l'état corrompu avant de resynchroniser (vide la file Redis + l'erreur MongoDB)
    await HistoryManager.promises.deleteProjectHistory(projectId)
    console.log(`État project-history effacé pour le projet ${projectId}`)
  } catch (err) {
    console.error(`Échec de l'effacement de l'état project-history pour ${projectId}:`, err.message)
  }
  try {
    await HistoryManager.promises.resyncProject(projectId, { force: true })
    console.log(`Historique resynchronisé (force) pour le projet ${projectId}`)
  } catch (err) {
    console.error(`Échec de la resynchronisation de l'historique pour ${projectId}:`, err.message)
  }
}

// Détecte si une erreur git est due à un conflit de merge
function isConflictError(error) {
  const msg = (error.git?.message || error.message || '').toLowerCase()
  return (
    msg.includes('conflict') ||
    msg.includes('automatic merge failed') ||
    msg.includes('unresolved conflict') ||
    msg.includes('unfinished merge')
  )
}

// Annule le merge en cours et retourne la liste des fichiers en conflit
async function abortMergeAndGetConflicts(projectId, userId, knownConflicts) {
  const localGit = getGitForProject(projectId, userId)
  let conflictedFiles = [...knownConflicts]
  if (conflictedFiles.length === 0) {
    try {
      const status = await localGit.status()
      conflictedFiles = status.conflicted
    } catch (_) {}
  }
  try {
    await localGit.merge(['--abort'])
    console.log(`Merge annulé pour le projet ${projectId}`)
  } catch (abortErr) {
    console.error("Impossible d'annuler le merge:", abortErr.message)
  }
  return conflictedFiles
}

// Formate le message d'erreur retourné à l'utilisateur en cas de conflit
function formatConflictMessage(conflictedFiles) {
  if (conflictedFiles.length === 0) {
    return 'Conflit de merge détecté. Le merge a été annulé — résolvez les conflits dans le dépôt distant puis relancez le pull.'
  }
  const fileList = conflictedFiles.join(', ')
  return `Conflit de merge sur ${conflictedFiles.length} fichier(s) : ${fileList}. Le merge a été annulé — résolvez les conflits dans le dépôt distant puis relancez le pull.`
}

// Normalise une URL git (SSH ou HTTPS) pour la comparaison inter-projets
function normalizeRemoteUrl(url) {
  if (!url) return null
  const s = url.trim()
  const sshMatch = s.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase()
  try {
    const u = new URL(s)
    u.username = ''
    u.password = ''
    u.hash = ''
    return (u.host + u.pathname.replace(/\.git$/, '')).toLowerCase()
  } catch { return s.toLowerCase() }
}

// Lève une erreur si un autre projet est déjà lié au même repo
async function assertRemoteNotAlreadyLinked(remoteUrl, excludeProjectId = null) {
  if (!remoteUrl) return
  const norm = normalizeRemoteUrl(remoteUrl)
  const projects = await Project.find(
    { 'git.remoteUrl': { $exists: true, $ne: null } },
    { _id: 1, name: 1, 'git.remoteUrl': 1 }
  ).lean().exec()
  for (const p of projects) {
    if (excludeProjectId && String(p._id) === String(excludeProjectId)) continue
    if (normalizeRemoteUrl(p.git?.remoteUrl) === norm) {
      throw new Error(`Ce dépôt est déjà lié au projet "${p.name}". Un dépôt ne peut être lié qu'à un seul projet à la fois.`)
    }
  }
}

async function saveGitLink(projectId, remoteUrl, branch, token = null, tokenType = null) {
  const fields = {
    'git.remoteUrl': remoteUrl || null,
    'git.branch': branch || 'main',
    'git.linkedAt': new Date(),
  }
  if (token) fields['git.token'] = token
  if (tokenType) fields['git.tokenType'] = tokenType
  await Project.updateOne({ _id: projectId }, { $set: fields }).exec()
  console.log(`Lien git sauvegardé pour le projet ${projectId}: remote=${remoteUrl}, branch=${branch}`)
}

function move(projectId, userId) {
  const fullPath = dataPath + projectId + "-" + userId
  git = simpleGit({ baseDir: fullPath, config: [`safe.directory=${fullPath}`, 'core.autocrlf=false', 'core.eol=lf'] })
  git.addConfig('user.name', 'overleaf')
  git.addConfig('user.email', 'overleaf@overleaf.com')
}

function getStatus(){
  return new Promise((resolve, reject) => {
      git.status((err, statusSummary) => {
          if (err) {
              reject(err);
              return;
          }
          else{
              resolve(statusSummary);
          }
        });
      });
}
async function safeGitCheckout(branchName) {
  try {
    if (fs.existsSync(lockFile)) {
      console.warn('Lock file exists. Attempting to remove it...');
      fs.unlinkSync(lockFile);
      console.log('Lock file removed.');
    }

    await git.checkout(branchName);
    console.log(`Checked out branch: ${branchName}`);
  } catch (err) {
    console.error('Git operation failed:', err.message);
  }
}

async function getStaged(projectId, userId) {
  const git = await getGitForProject(projectId, userId);
    try {
        const status = await git.status()
        const stagedFiles = status.staged

        return stagedFiles
    } catch (error) {
        console.error("Error fetching staged files:", error);
        return []
    }
}

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
        if (bannedFiles.includes(item)) continue
        if (trackedSet.has(relPath) || gitStatusSet.has(relPath)) continue
        const gitFilePath = path.join(gitDir, relPath)
        if (!await fs.pathExists(gitFilePath)) {
          result.push(relPath)
        }
      }
    }
  }
  await recurse(compilesDir)
  return result
}

async function getNotStaged(projectId, userId) {
  const localGit = getGitForProject(projectId, userId)
  const gitDir = dataPath + projectId + "-" + userId
  const compilesDir = outputPath + projectId + "-" + userId

  try {
    const status = await localGit.status(['-uall'])
    const modifiedFiles = status.files.filter(f => f.working_dir !== ' ' && f.index === ' ').map(f => f.path)
    const untrackedFiles = status.files.filter(f => f.working_dir === '?' && f.index === '?').map(f => f.path)
    const gitStatusSet = new Set([...modifiedFiles, ...untrackedFiles])

    // Also find files that exist in compiles/ but not yet in the git working dir
    // (e.g. images uploaded after the last gitUpdate)
    let overleafOnlyFiles = []
    if (await fs.pathExists(compilesDir)) {
      let trackedSet = new Set()
      try {
        const result = await localGit.raw(['ls-files'])
        trackedSet = new Set(result.split('\n').filter(f => f.trim()))
      } catch (_) {}
      overleafOnlyFiles = await scanCompilesDirForNewFiles(compilesDir, gitDir, trackedSet, gitStatusSet)
    }

    const notStagedFiles = [...modifiedFiles, ...untrackedFiles, ...overleafOnlyFiles]
    console.log('notStaged:', notStagedFiles)
    return notStagedFiles
  } catch (error) {
    console.error("Error fetching not staged files:", error)
    return []
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

// Exécute fn(remote, info) avec l'authentification :
// - token disponible → URL HTTPS authentifiée (jamais loggée)
// - pas de token     → clé SSH, remote = 'origin'
async function withRemoteAuth(projectId, userId, fn) {
  const info = await getGitInfo(projectId)
  if (info?.token && info?.remoteUrl) {
    const authUrl = buildAuthenticatedUrl(info.remoteUrl, info.token, info.tokenType)
    return fn(authUrl, info)
  }
  return withSshKey(userId, () => fn('origin', info))
}

async function getBranches(projectId, userId) {
  try {
    move(projectId, userId)
    return await withRemoteAuth(projectId, userId, async (remote) => {
      await git.fetch(remote)
      console.log("fetched")
      const branches = await git.branch(['-r'])
      console.log('Remote branches:', branches.all)
      return branches.all
    })
  } catch (err) {
    console.error("Error fetching branches:", err)
    return []
  }
}

async function getCurrentBranch(projectId, userId) {
  try {
    move(projectId, userId)
    return await withRemoteAuth(projectId, userId, async (remote) => {
      await git.fetch(remote)
      const stat = await git.status()
      console.log("Current Branch (status):", stat.current)
      return `origin/${stat.current}`
    })
  } catch (err) {
    console.error("Error fetching current branches:", err)
    return ""
  }
}

async function getModified() {

    try {
        const status = await git.status()
        const modifiedFiles = status.modified

        return modifiedFiles
    } catch (error) {
        console.error("Error fetching modified files:", error);
        return []
    }
}

// historique des commits
async function getCommitHistory(limit = 10) {
    try {
        // Utilisation du format standard de simple-git
        const log = await git.log([`-${limit}`])
        return log.all.map(commit => ({
            hash: commit.hash,
            message: commit.message,
            date: commit.date,
            author: commit.author_name || 'Unknown'
        }))
    } catch (error) {
        console.error("Error fetching commit history:", error);
        return []
    }
}

// effectuer un reset hard vers un commit spécifique
async function resetToCommit(commitHash, projectId, ownerId) {
    try {
        // Extraire seulement le hash si c'est au format personnalisé
        let cleanHash = commitHash.trim()
        
        // Si le hash contient des pipes (ancien format), extraire seulement le hash
        if (cleanHash.includes('|')) {
            cleanHash = cleanHash.split('|')[0]
        }
        
        // Prendre seulement les premiers caractères si c'est un hash tronqué
        cleanHash = cleanHash.split(/\s+/)[0]
        
        console.log(`Resetting to commit: ${cleanHash}`)
        
        // Vérifier que le commit existe
        try {
            await git.show([cleanHash, '--format=format:', '--name-only'])
        } catch (error) {
            throw new Error(`Commit ${cleanHash} not found in repository`)
        }
        
        // Reset hard vers le commit
        await git.reset(['--hard', cleanHash])
        
        // Nettoyage du workspace
        await git.clean('f')
        
        console.log(`Reset to commit ${cleanHash} successful`)
        return true
    } catch (error) {
        console.error("Error resetting to commit:", error);
        throw error
    }
}
async function rebuildProjectAfterRollback(projectPath, projectId, ownerId) {
    try {
        console.log("Starting project rebuild after rollback...")
        
        // Supprimer tous les fichiers/dossiers existants dans Overleaf
        console.log(projectId)
        console.log(ownerId)
        console.log(projectPath)
        
        // Reconstruire le projet depuis les fichiers Git
        await buildProject(projectPath, projectId, ownerId, getRootId(projectId),true)
        
        console.log("Project rebuild completed successfully")
        return true
    } catch (error) {
        console.error("Error rebuilding project:", error)
        throw error
    }
}

async function disableBinaryConversion(repoPath) {
  // Empêche toute conversion de fin de ligne par git, quels que soient les paramètres .gitattributes
  // .git/info/attributes a la priorité maximale dans git et écrase le .gitattributes du dépôt
  try {
    await fs.ensureDir(path.join(repoPath, '.git', 'info'))
    await fs.writeFile(path.join(repoPath, '.git', 'info', 'attributes'), '* -text\n', 'utf8')
    console.log(`Git info/attributes written for ${repoPath}`)
  } catch (err) {
    console.error('Could not write git info/attributes:', err.message)
  }
}

async function gitClone(projectId, ownerId, link, branch = null, token = null, tokenType = null){
  await assertRemoteNotAlreadyLinked(link, projectId)

  const repoPath = dataPath + projectId + "-" + ownerId

  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath)
  }

  // --no-checkout : cloner sans extraire les fichiers pour pouvoir écrire les attributs en premier
  const cloneOptions = ['--no-checkout']
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

  // Écrire les attributs AVANT le checkout pour que git n'applique jamais de conversion de texte aux fichiers binaires
  await disableBinaryConversion(repoPath)
  const localGit = getGitForProject(projectId, ownerId)
  try {
    await localGit.raw(['checkout', 'HEAD', '--', '.'])
    console.log("Initial checkout done with binary attributes applied")
  } catch (checkoutErr) {
    console.error("Initial checkout failed:", checkoutErr.message)
    throw checkoutErr
  }
  await buildProject(repoPath, projectId, ownerId, getRootId(projectId))
  await saveGitLink(projectId, link, branch, token, tokenType)

  try {
    await fs.remove(outputPath + projectId + "-" + ownerId)
    console.log('Répertoire de compilation CLSI supprimé')
  } catch (e) {
    console.log('Impossible de supprimer le répertoire de compilation CLSI:', e.message)
  }
  try {
    await fs.chmod(clsiCachePath, 0o777)
    await fs.remove(clsiCachePath + projectId)
    console.log('Cache CLSI du projet supprimé')
  } catch (e) {
    console.log('Impossible de corriger le cache CLSI:', e.message)
  }

  resyncHistory(projectId) // arrière-plan : ne bloque pas la réponse
}

// Vérifie si le dossier projet est déjà lié à un repo git
async function isGitRepo(projectId, ownerId) {
  const project = await Project.findById(projectId, 'git').lean().exec()
  if (project?.git?.linkedAt) return true
  const repoPath = dataPath + projectId + "-" + ownerId
  return fs.pathExists(path.join(repoPath, '.git'))
}

async function getGitInfo(projectId) {
  const project = await Project.findById(projectId, 'git').lean().exec()
  return project?.git || null
}


// Initialise un repo git local pour le projet, puis y attache un remote et pousse la branche initiale.
// Si le dossier n'existe pas encore, il est créé.
// remoteUrl est optionnel : si fourni, le remote "origin" est configuré et un push initial est tenté.
async function gitInit(projectId, ownerId, remoteUrl = null, defaultBranch = 'main', token = null, tokenType = null) {
  await assertRemoteNotAlreadyLinked(remoteUrl, projectId)

  const repoPath = dataPath + projectId + "-" + ownerId

  await fs.ensureDir(repoPath)

  const alreadyRepo = await isGitRepo(projectId, ownerId)
  if (alreadyRepo) {
    console.log(`Le projet ${projectId} est déjà un repo git, gitInit ignoré.`)
    return { created: false, remoteLinked: false }
  }
 
  // Initialiser le repo
  const localGit = simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf']
  })
  await localGit.init()
  await localGit.addConfig('user.name', 'overleaf')
  await localGit.addConfig('user.email', 'overleaf@overleaf.com')
 
  // Écrire les attributs binaires pour éviter toute conversion de fins de ligne
  await disableBinaryConversion(repoPath)
 
  // Commit initial vide pour que la branche existe
  await localGit.raw(['commit', '--allow-empty', '-m', 'Initial commit'])
 
  // Renommer la branche par défaut si besoin (git init crée "master" par défaut)
  try {
    await localGit.raw(['branch', '-M', defaultBranch])
  } catch (err) {
    console.warn(`Impossible de renommer la branche en "${defaultBranch}":`, err.message)
  }
 
  console.log(`Repo git initialisé dans ${repoPath} (branche: ${defaultBranch})`)
 
  // Lier le remote et pousser si une URL est fournie
  let remoteLinked = false
  if (remoteUrl) {
    await localGit.addRemote('origin', remoteUrl)
    console.log(`Remote "origin" configuré sur ${remoteUrl}`)
    try {
      if (token) {
        const authUrl = buildAuthenticatedUrl(remoteUrl, token, tokenType)
        await localGit.push(authUrl, defaultBranch, ['--set-upstream'])
      } else {
        await withSshKey(ownerId, () =>
          localGit.push(['-u', 'origin', defaultBranch])
        )
      }
      console.log(`Branche "${defaultBranch}" poussée sur origin`)
      remoteLinked = true
    } catch (pushErr) {
      console.error('Push initial échoué (le remote est configuré mais pas synchronisé):', pushErr.message)
      // On ne lève pas l'erreur : le repo local est valide, le remote peut être lié manuellement
    }
  }

  await saveGitLink(projectId, remoteUrl, defaultBranch, token, tokenType)
  return { created: true, remoteLinked }
}

function convertPemToOpenSSH(pemKey) {
  try {

    const key = sshpk.parseKey(pemKey, 'pem')
    const openSSHKey = key.toString('ssh')

    console.log('Key converted to OpenSSH format successfully!')
    return openSSHKey
  } catch (error) {
    console.error('Error converting key:', error)
    return ""
  }
}


async function generateKeyPairAsync() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }, (err, publicKey, privateKey) => {
      if (err) {
        reject(err)
      } else {
        resolve({ publicKey, privateKey })
      }
    })
  })
}

async function makeKey(keyPath) {
   try {

    await fs.mkdir(keyPath)


    const { publicKey, privateKey } = await generateKeyPairAsync()

    await Promise.all([
      fs.writeFile(keyPath + "/public", publicKey, 'utf8'),
      fs.writeFile(keyPath + "/private", privateKey, 'utf8')
    ])
    fs.chmod(keyPath + "/private", 0o600, (err) => {
      if (err) {
         console.error(`Error changing permissions : ${err.message}`);
      return;
      }
      console.log('Permissions changed');
      })

    console.log('SSH keys generated successfully!')
  } catch (error) {
    console.error('Error generating SSH key:', error)
  }
}

async function getKey(userId, type) {
  const keyPath = dataPath + "keys/" + userId
  console.log(keyPath)
  if (!fs.existsSync(keyPath + '/private')) {
    await makeKey(keyPath)
  }
  if (type === 'private') {
    const privateKey = "/" + dataPath + "keys/" + userId + "/private"
    console.log(privateKey)
    return privateKey

  } else {
    const publicKeyPEM = await fs.readFile(keyPath + '/public', 'utf8')
    const publicKey = convertPemToOpenSSH(publicKeyPEM)
    return publicKey
  }
}

function deleteFolderContents(folderPath) {
    const files = fs.readdirSync(folderPath)

    files.forEach(file => {
        const filePath = path.join(folderPath, file)

        if (file === '.git') {
            return
        }

        const stats = fs.lstatSync(filePath)

        if (stats.isDirectory()) {
            deleteFolderContents(filePath)
            fs.rmdirSync(filePath)
        } else {
            fs.unlinkSync(filePath)
        }
    })
}

function resetFolder(src) {
    if (!fs.existsSync(src)) {
        return
    }

    const stats = fs.lstatSync(src)

    if (!stats.isDirectory()) {
        return
    }

    deleteFolderContents(src)
    console.log(`${src} folder reset`)
}

async function gitUpdate(projectId, ownerId, extraFiles = []) {
  console.log("Copying")
  const src = outputPath + projectId + "-" + ownerId
  const dest = dataPath + projectId + "-" + ownerId

  await fs.ensureDir(dest);

  if (!await fs.pathExists(src)) {
    console.log(`Source folder ${src} does not exist yet, skipping gitUpdate`)
    return
  }

  // Récupérer la liste des fichiers déjà trackés par Git
  const localGit = await getGitForProject(projectId, ownerId)
  let trackedFiles = []
  try {
    const result = await localGit.raw(['ls-files'])
    trackedFiles = result.split('\n').filter(f => f.trim() !== '')
    console.log(`Git tracked files: ${trackedFiles}`)
  } catch (err) {
    console.log('Could not get tracked files from git, skipping gitUpdate:', err.message)
    return
  }

  // Fusionner les fichiers trackés avec les fichiers extra (ex: nouveau fichier à git add)
  const filesToCopy = [...new Set([...trackedFiles, ...extraFiles])]

  // Supprimer les fichiers bannis s'ils traînent dans le dossier Git
  for (const banned of bannedFiles) {
    const bannedPath = path.join(dest, banned)
    if (await fs.pathExists(bannedPath)) {
      try {
        await fs.remove(bannedPath)
        console.log(`Removed banned file from git folder: ${banned}`)
      } catch (err) {
        console.error(`Could not remove banned file ${banned} (permission issue?):`, err.message)
      }
    }
  }

  // Construire l'index path→hash des fichiers binaires du projet (pour le fallback blob store)
  let projectFilesIndex = {}
  try {
    const allFiles = await ProjectEntityHandler.promises.getAllFiles(projectId)
    for (const [filePath, fileObj] of Object.entries(allFiles)) {
      const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
      if (fileObj.hash) projectFilesIndex[normalized] = fileObj.hash
    }
  } catch (err) {
    console.log('Could not build project files index:', err.message)
  }

  // Copier les fichiers depuis compiles/ vers git/, avec fallback blob store
  for (const file of filesToCopy) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);

    if (await fs.pathExists(srcFile)) {
      try {
        await fs.ensureDir(path.dirname(destFile))
        await fs.copy(srcFile, destFile, { overwrite: true });
        console.log(`Updated file: ${file}`)
      } catch (err) {
        console.error(`Could not copy ${file} to git dir (permission issue?):`, err.message)
      }
    } else {
      // Fallback : télécharger depuis le blob store (images non utilisées dans le .tex)
      const hash = projectFilesIndex[file]
      if (hash) {
        try {
          const { stream } = await HistoryManager.promises.requestBlobWithProjectId(projectId, hash, 'GET')
          await fs.ensureDir(path.dirname(destFile))
          await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(destFile)
            stream.pipe(writeStream)
            writeStream.on('finish', resolve)
            writeStream.on('error', reject)
            stream.on('error', reject)
          })
          console.log(`Downloaded from blob store: ${file}`)
        } catch (err) {
          console.error(`Could not download ${file} from blob store:`, err.message)
        }
      } else {
        console.log(`File not found in compiles or blob store, skipping: ${file}`)
      }
    }
  }

  console.log("gitUpdate done")
}


GitController = {

  test(req, res){
    console.log("[TEST COMPLETED]")
    res.sendStatus(200)
  },

  async gitInfo(req, res) {
    const projectId = req.query.projectId
    if (!projectId) return res.status(400).json({ error: 'projectId requis.' })
    try {
      const info = await getGitInfo(projectId)
      res.json(info || {})
    } catch (err) {
      HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }
  },

    // Initialise un repo git local pour le projet et, si remoteUrl est fourni, le lie au remote.
  // Body attendu : { projectId, userId, remoteUrl? (optionnel), branch? (défaut: "main") }
  async init(req, res) {
    const { projectId, userId, remoteUrl = null, branch = 'main', token = null, tokenType = null } = req.body
 
    if (!projectId || !userId) {
      return res.status(400).json({ error: 'projectId et userId sont requis.' })
    }
 
    try {
      const alreadyRepo = await isGitRepo(projectId, userId)
      if (alreadyRepo) {
        console.log(`Projet ${projectId} déjà lié à un repo git.`)
        return res.status(200).json({ created: false, remoteLinked: false, message: 'Ce projet est déjà un repo git.' })
      }
 
      const result = await gitInit(projectId, userId, remoteUrl, branch, token, tokenType)
      console.log(`gitInit terminé pour ${projectId}:`, result)
 
      return res.status(200).json({
        ...result,
        message: result.created
          ? (result.remoteLinked
              ? `Repo créé et lié au remote ${remoteUrl} (branche: ${branch}).`
              : `Repo créé localement${remoteUrl ? ', mais le push initial a échoué (vérifiez l\'URL et les droits SSH).' : '.'}`)
          : 'Ce projet est déjà un repo git.'
      })
    } catch (error) {
      console.error('Erreur dans gitInit:', error)
      HttpErrorHandler.gitMethodError(req, res, error?.message || String(error))
    }
  },

  async pull(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const projectPath = dataPath + projectId + "-" + userId

    console.log("Pulling")
    move(projectId, userId)
    const localGit = getGitForProject(projectId, userId)

    // Compiler pour copier le contenu actuel de l'éditeur Overleaf (MongoDB) vers compiles/,
    // puis gitUpdate copie compiles/ → dossier git. Sans cette étape, des éditions non compilées
    // seraient invisibles pour le stash et seraient perdues lors du pull.
    try {
      await compileProject(projectId, userId)
      console.log("Compilation réussie avant pull")
    } catch (compileError) {
      console.log("Compilation échouée avant pull, on utilise le dernier état compilé:", compileError.message)
    }

    // Synchroniser le contenu Overleaf (compiles/) → dossier git avant de stasher.
    try {
      await gitUpdate(projectId, userId)
      console.log("gitUpdate effectué avant stash")
    } catch (updateError) {
      console.log("gitUpdate échoué avant stash, on continue:", updateError.message)
    }

    // Sauvegarder les changements locaux non commités pour les restaurer après le pull
    let stashed = false
    try {
      const status = await localGit.status()
      if (status.files.length > 0) {
        await localGit.stash(['push', '-u', '-m', 'overleaf-auto-stash-before-pull'])
        stashed = true
        console.log(`${status.files.length} fichier(s) stashé(s) avant pull`)
      }
    } catch (stashErr) {
      console.log("Stash échoué, on continue:", stashErr.message)
    }

    try {
      await disableBinaryConversion(projectPath)
      const update = await withRemoteAuth(projectId, userId, (remote, info) =>
        localGit.pull(remote, info?.branch || null, {'--no-rebase': null})
      )

      if (update.conflicts && update.conflicts.length > 0) {
        // Conflit de merge : restaurer le stash avant d'abandonner le merge
        if (stashed) {
          try { await localGit.raw(['reset', '--hard', 'HEAD']); await localGit.stash(['pop']) } catch (_) {}
        }
        const conflictedFiles = await abortMergeAndGetConflicts(projectId, userId, update.conflicts)
        return HttpErrorHandler.gitMethodError(req, res, formatConflictMessage(conflictedFiles))
      }

      console.log("Repository pulled")
      // Ré-extraire tous les fichiers pour corriger toute corruption binaire due à d'anciens attributs de texte
      try {
        await localGit.raw(['checkout', 'HEAD', '--', '.'])
        console.log("Files re-checked out with binary attributes applied")
      } catch (recheckoutErr) {
        console.error("Re-checkout failed:", recheckoutErr.message)
      }

      // Restaurer les changements stashés par-dessus le résultat du pull
      let stashConflict = false
      if (stashed) {
        try {
          await localGit.stash(['pop'])
          console.log("Stash restauré après pull")
        } catch (stashPopErr) {
          stashConflict = true
          console.error("Conflit lors de la restauration du stash:", stashPopErr.message)
          // Le stash entre en conflit avec le remote : abandonner le stash, garder l'état pullé
          try {
            await localGit.raw(['reset', '--hard', 'HEAD'])
            await localGit.stash(['drop'])
          } catch (_) {}
        }
      }

      // Supprimer les fichiers de compilation parasites du dossier Git
      for (const banned of bannedFiles) {
        const bannedPath = path.join(projectPath, banned)
        if (await fs.pathExists(bannedPath)) {
          await fs.remove(bannedPath)
          console.log(`Removed banned file after pull: ${banned}`)
        }
      }

      await buildProject(projectPath, projectId, userId, getRootId(projectId))

      // Le service CLSI (www-data) ne peut pas écrire dans son cache si le dossier du projet
      // a été créé par root. On supprime le cache et le dossier de compilation du projet
      // (en tant que root on peut tout supprimer) et on s'assure que le dossier parent du
      // cache est accessible en écriture, afin que CLSI les recrée lui-même avec les bonnes
      // permissions lors du prochain compile.
      try {
        await fs.remove(outputPath + projectId + "-" + userId)
        console.log('Répertoire de compilation CLSI supprimé')
      } catch (e) {
        console.log('Impossible de supprimer le répertoire de compilation CLSI:', e.message)
      }
      try {
        await fs.chmod(clsiCachePath, 0o777)
        await fs.remove(clsiCachePath + projectId)
        console.log('Cache CLSI du projet supprimé')
      } catch (e) {
        console.log('Impossible de corriger le cache CLSI:', e.message)
      }

      resyncHistory(projectId) // arrière-plan : ne bloque pas la réponse

      if (stashConflict) {
        return HttpErrorHandler.gitMethodError(req, res,
          'Pull effectué, mais vos modifications locales non commitées étaient en conflit avec le dépôt distant et ont été écartées.')
      }
      res.sendStatus(200)

    } catch (error) {
      if (res.headersSent) return
      // En cas d'erreur, tenter de restaurer le stash
      if (stashed) {
        try { await localGit.raw(['reset', '--hard', 'HEAD']); await localGit.stash(['pop']) } catch (_) {}
      }
      if (isConflictError(error)) {
        const conflictedFiles = await abortMergeAndGetConflicts(projectId, userId, [])
        return HttpErrorHandler.gitMethodError(req, res, formatConflictMessage(conflictedFiles))
      }
      console.error("Error.git: ", error.git)
      console.error("Error.message: ", error.message)
      HttpErrorHandler.gitMethodError(req, res, error?.git?.message || error?.message || String(error))
    }
  },

  async add(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const filePath = req.body.filePath
    const deleted = req.body.deleted === true
    console.log("Adding " + filePath + (deleted ? " (deletion)" : ""))
    move(projectId, userId)

    if (deleted) {
      // File was deleted from Overleaf: remove it from the git working tree
      // (if still present from a previous state) then let git.add stage the deletion.
      const gitFilePath = path.join(dataPath + projectId + "-" + userId, filePath)
      try {
        if (await fs.pathExists(gitFilePath)) {
          await fs.remove(gitFilePath)
          console.log(`Removed deleted file from git working tree: ${filePath}`)
        }
      } catch (err) {
        console.log(`Could not remove ${filePath} from git working tree:`, err.message)
      }
    } else {
      try {
        await compileProject(projectId, userId)
        console.log("Compilation réussie avant le add")
      } catch (compileError) {
        console.log("Compilation échouée avant add, on utilise le dernier état compilé:", compileError.message)
      }
      try {
        await gitUpdate(projectId, userId, [filePath])
      } catch(error) {
        console.log("error when syncing in git add", error)
      }
    }

    git.add(filePath, (error) => {
        if (error) {
          console.error("Could not add the file", error)
          HttpErrorHandler.gitMethodError(req, res, error?.git?.message || error?.message || String(error));
        }
        else{
          console.log('File added')
          res.sendStatus(200)
        }
     })
  },

  commit(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const message = req.body.message
    console.log("Commit with message: " + message)
    if (!message || message.trim() === "") {
      console.log("Empty commit messages are not permitted")
      HttpErrorHandler.gitMethodError(req, res, "Please add a commit message before committing.")
      return
    }
    move(projectId, userId)

    git.commit(message, (error) => {
        if (error) {
          console.error("Could not commit", error)
          HttpErrorHandler.gitMethodError(req, res, error)
        }
        else{
          console.log('Commit successful')
          res.sendStatus(200)
        }
     })
  },

  push(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    console.log("Pushing")
    move(projectId, userId)
    withRemoteAuth(projectId, userId, (remote, info) =>
      git.push(remote, info?.branch || null)
    )
      .then(() => {
        console.log('Push successful')
        res.sendStatus(200)
      })
      .catch(error => {
        console.error("Error:", error)
        HttpErrorHandler.gitMethodError(req, res, error?.git?.message || error?.message || String(error))
      })
  },

  // Route pour obtenir l'historique des commits
  commitHistory(req, res) {
    const { projectId, userId } = req.query
    const limit = req.query.limit || 10

    move(projectId, userId)

    getCommitHistory(parseInt(limit))
      .then(commits => {
        res.json(commits)
        console.log("Commit history fetched successfully")
      })
      .catch(error => {
        console.error("Error fetching commit history:", error)
        res.json([])
      })
  },

  // Route pour effectuer un rollback
  rollback(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const commitHash = req.body.commitHash
    const projectPath = dataPath + projectId + "-" + userId

    console.log(`Rolling back to commit ${commitHash}`)
    console.log(`Project path: ${projectPath}`)
    
    if (!commitHash || !commitHash.trim()) {
        console.error("No commit hash provided")
        res.status(400).json({ error: "No commit hash provided" })
        return
    }

    move(projectId, userId)

    resetToCommit(commitHash, projectId, userId)
      .then(() => {
        console.log("Rollback successful, rebuilding project")
        return rebuildProjectAfterRollback(projectPath, projectId, userId)
      })
      .then(() => {
        console.log('Rollback and rebuild successful')
        res.json({ 
          success: true, 
          message: 'Rollback and rebuild successful' 
        })
      })
      .catch(error => {
        console.error("Error during rollback:", error)
      res.status(500).json({ 
        success: false,
        error: error.message || 'Rollback failed'
      })
    })
},

  stagedFiles(req, res) {
    const { projectId, userId } = req.query

    move(projectId, userId)

    getStaged(projectId,userId)
    .then(stagedFilesList => {
      res.json(stagedFilesList)
    })
    .catch(error => {
      console.error("Error:", error)
      res.json([])
    })
  },

  notStagedFiles(req, res) {
    const { projectId, userId } = req.query

    move(projectId, userId)

    getNotStaged(projectId,userId)
    .then(notStagedFilesList => {
      res.json(notStagedFilesList)
    })
    .catch(error => {
      console.error("Error:", error)
      res.json([])
    })
  },

  currentBranch(req, res) {
    const { projectId, userId } = req.query
    move(projectId, userId)
    getCurrentBranch(projectId, userId)
      .then(currBranch=> {
        res.json(currBranch)
      })
      .catch(error => {
        console.error("Error fetching current Branch:", error)
        res.json("")
      })
  },

  branches(req, res) {
    const { projectId, userId } = req.query
    move(projectId, userId)
    getBranches(projectId, userId)
      .then(branchList => {
        res.json(branchList)
      })
      .catch(error => {
        console.error("Error fetching branches:", error)
        res.json([])
      })
  },

  async switch_branch(req, res) {
    const { projectId, userId, branchName } = req.body
    const projectPath = dataPath + projectId + "-" + userId
    console.log("switch branch to:", branchName)

    try {
      move(projectId, userId)
      await withRemoteAuth(projectId, userId, (remote) => git.fetch(remote))

      // branchName est au format "origin/ma-branche", on extrait la partie locale
      const [, localBranch] = branchName.split('/')
      const localBranches = await git.branchLocal()

      if (localBranches.all.includes(localBranch)) {
        await git.checkout(localBranch)
      } else {
        await git.checkout(['-b', localBranch, branchName])
      }
      console.log("Switched to branch:", localBranch)

      // Appliquer les attributs binaires et ré-extraire pour éviter la corruption des fichiers binaires
      await disableBinaryConversion(projectPath)
      const localGit = getGitForProject(projectId, userId)
      await localGit.raw(['checkout', 'HEAD', '--', '.'])

      await buildProject(projectPath, projectId, userId, getRootId(projectId))
      resyncHistory(projectId) // arrière-plan : ne bloque pas la réponse
      res.sendStatus(200)
    } catch (error) {
      console.error("Git checkout failed:", error)
      HttpErrorHandler.gitMethodError(req, res, error?.message || String(error))
    }
  },

  async createBranch(req, res) {
    console.log("Here at create Branch");
    const { projectId, userId, newBranchName } = req.body;
    const projectPath = dataPath + projectId + "-" + userId;
    try {
      move(projectId, userId);
      const BranchCreationSummary = await git.checkoutLocalBranch(newBranchName);
      console.log("created new branch: ", newBranchName)

      await withRemoteAuth(projectId, userId, (remote) =>
        git.push(remote, newBranchName, ['--set-upstream'])
      )
      console.log(`Branch '${newBranchName}' pushed to origin`)

      res.sendStatus(200);

      } catch (error) {
        console.error("Create branch failed:", error);
        await buildProject(projectPath, projectId, userId, getRootId(projectId));
        HttpErrorHandler.gitMethodError(req, res, error?.git?.message || error?.message || String(error));
      }
    },

  getKey(req, res) {
    function getUserIdFromUrl(url) {
      const regex = /\/ssh-key\?userId=(?<userId>[^\&]+)/
      const match = url.match(regex)

      if (match) {
        return match.groups.userId
      } else {
        return null
      }
    }
    const userId = getUserIdFromUrl(req.url)
    const privateKey = getKey(userId, 'public')
    privateKey.then((privateKeyValue) => {
      res.send(privateKeyValue)
    });
  },

  async addAll(req, res) {
    const { projectId, userId } = req.body
    if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId sont requis.' })
    move(projectId, userId)
    try {
      try {
        await compileProject(projectId, userId)
        console.log("Compilation réussie avant addAll")
      } catch (compileError) {
        console.log("Compilation échouée avant addAll, on utilise le dernier état compilé:", compileError.message)
      }
      const newFiles = await getNotStaged(projectId, userId)
      await gitUpdate(projectId, userId, newFiles)
      await git.add('.')
      res.sendStatus(200)
    } catch (err) {
      HttpErrorHandler.gitMethodError(req, res, err?.git?.message || err?.message || String(err))
    }
  },

  async saveToken(req, res) {
    const { projectId, token, tokenType } = req.body
    if (!projectId) return res.status(400).json({ error: 'projectId requis.' })
    try {
      const fields = {}
      if (token !== undefined) fields['git.token'] = token || null
      if (tokenType !== undefined) fields['git.tokenType'] = tokenType || null
      await Project.updateOne({ _id: projectId }, { $set: fields }).exec()
      res.json({ success: true })
    } catch (err) {
      HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }
  },
}

module.exports = {GitController, gitClone, gitUpdate, gitInit}
