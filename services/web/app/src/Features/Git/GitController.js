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
const SessionManager = require('../Authentication/SessionManager.mjs').default
const ProjectGetter = require('../Project/ProjectGetter.mjs').default
const Settings = require('@overleaf/settings')

// URL du service git (résiliente : marche même sans entrée dans settings.defaults)
const GIT_SERVICE_URL =
  (Settings.apis && Settings.apis.gitService && Settings.apis.gitService.url) ||
  `http://${process.env.GIT_SERVICE_HOST || '127.0.0.1'}:3099`

// Valide un identifiant Mongo (24 caractères hexadécimaux)
function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)
}

// Vérifie qu'un filePath fourni par le client est un chemin relatif sûr,
// confiné au dépôt du projet. Rejette les chemins absolus et tout segment de
// remontée ("..") afin d'empêcher le path traversal (lecture/suppression hors projet).
function isSafeRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false
  if (path.isAbsolute(filePath)) return false
  // Découpe sur / et \ et rejette tout segment de remontée
  return !filePath.split(/[/\\]+/).some(segment => segment === '..')
}

// Middleware : lit projectId depuis le body/query, le valide, et l'expose dans
// req.params.Project_id pour que les middlewares d'autorisation Overleaf
// (ensureUserCanReadProject / ensureUserCanWriteProjectContent) puissent l'utiliser.
function setProjectIdParam(req, res, next) {
  const fromBody = req.body && req.body.projectId
  const fromQuery = req.query && req.query.projectId
  if (fromBody && fromQuery && fromBody !== fromQuery) {
    return res.status(400).json({ error: 'projectId ambigu.' })
  }
  const projectId = fromBody || fromQuery
  if (!isValidObjectId(projectId)) {
    return res.status(400).json({ error: 'projectId invalide.' })
  }
  req.params = req.params || {}
  req.params.Project_id = projectId
  if (req.body) req.body.projectId = projectId
  if (req.query) req.query.projectId = projectId
  next()
}

// Middleware : résout le propriétaire du projet côté serveur et l'injecte dans
// req.body.userId / req.query.userId. Le dossier git est indexé par l'owner
// (projectId-ownerId) ; on ne fait donc jamais confiance au userId envoyé par le client.
// À utiliser APRÈS un middleware d'autorisation (qui garantit l'accès au projet).
async function injectGitOwner(req, res, next) {
  try {
    const projectId = req.params.Project_id
    const project = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
    if (!project) {
      return res.status(404).json({ error: 'Projet introuvable.' })
    }
    const ownerId = String(project.owner_ref)
    if (req.body) req.body.userId = ownerId
    if (req.query) req.query.userId = ownerId
    req.gitOwnerId = ownerId
    next()
  } catch (err) {
    HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
  }
}

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
    { 'git.remoteUrl': { $exists: true, $ne: null }, deletedAt: { $exists: false } },
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
    const modifiedFiles = status.files.filter(f => f.working_dir !== ' ' && f.working_dir !== 'D' && f.index === ' ').map(f => f.path)
    const untrackedFiles = status.files.filter(f => f.working_dir === '?' && f.index === '?').map(f => f.path)
    const gitStatusSet = new Set([...modifiedFiles, ...untrackedFiles])

    // Fichiers suivis par git
    let trackedSet = new Set()
    try {
      const result = await localGit.raw(['ls-files'])
      trackedSet = new Set(result.split('\n').filter(f => f.trim()))
    } catch (_) {}

    // Fichiers dans compiles/ non encore dans le working tree git
    let overleafOnlyFiles = []
    if (await fs.pathExists(compilesDir)) {
      overleafOnlyFiles = await scanCompilesDirForNewFiles(compilesDir, gitDir, trackedSet, gitStatusSet)
    }

    // Tous les fichiers Overleaf (docs texte + binaires) non suivis par git
    try {
      const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
      const alreadyListed = new Set([...modifiedFiles, ...untrackedFiles, ...overleafOnlyFiles])
      for (const { path: filePath } of [...docs, ...files]) {
        const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
        if (!trackedSet.has(normalized) && !alreadyListed.has(normalized) && !gitStatusSet.has(normalized)) {
          overleafOnlyFiles.push(normalized)
        }
      }
    } catch (err) {
      console.log('Could not check Overleaf entities:', err.message)
    }

    const notStagedFiles = [...modifiedFiles, ...untrackedFiles, ...overleafOnlyFiles]

    // Suppressions en attente enregistrées par markDeleted
    const project = await Project.findById(projectId, 'git.pendingDeletions').lean().exec()
    const deletedFiles = project?.git?.pendingDeletions || []

    console.log('notStaged:', notStagedFiles, 'deleted:', deletedFiles)
    return { notStaged: notStagedFiles, deleted: deletedFiles }
  } catch (error) {
    console.error("Error fetching not staged files:", error)
    return { notStaged: [], deleted: [] }
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

  // Construire l'index path→lignes des docs texte (pour le fallback docstore)
  let projectDocsIndex = {}
  try {
    const allDocs = await ProjectEntityHandler.promises.getAllDocs(projectId)
    for (const [filePath, docObj] of Object.entries(allDocs)) {
      const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
      if (docObj.lines) projectDocsIndex[normalized] = docObj.lines
    }
  } catch (err) {
    console.log('Could not build project docs index:', err.message)
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
        // Fallback 2 : docstore (fichiers texte non compilés)
        const lines = projectDocsIndex[file]
        if (lines) {
          try {
            await fs.ensureDir(path.dirname(destFile))
            await fs.writeFile(destFile, lines.join('\n'), 'utf8')
            console.log(`Written from docstore: ${file}`)
          } catch (err) {
            console.error(`Could not write ${file} from docstore:`, err.message)
          }
        } else {
          console.log(`File not found in compiles, blob store, or docstore, skipping: ${file}`)
        }
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
      // Ne jamais exposer le token au client : on renvoie uniquement un booléen.
      res.json({
        remoteUrl: info?.remoteUrl || null,
        branch: info?.branch || null,
        linkedAt: info?.linkedAt || null,
        tokenType: info?.tokenType || null,
        hasToken: !!info?.token,
      })
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
    const { projectId, userId } = req.body
    const projectPath = dataPath + projectId + "-" + userId
    console.log("Pulling")

    try {
      await compileProject(projectId, userId)
      console.log("Compilation réussie avant pull")
    } catch (compileError) {
      console.log("Compilation échouée avant pull, on utilise le dernier état compilé:", compileError.message)
    }
    try {
      await gitUpdate(projectId, userId)
      console.log("gitUpdate effectué avant pull")
    } catch (updateError) {
      console.log("gitUpdate échoué avant pull, on continue:", updateError.message)
    }

    // déléguer la partie git au git-service (stash, pull, conflits, re-checkout, pop)
    let result
    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, gitInfo }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
      }
      result = await response.json() // { status: 'ok' | 'conflict' | 'stash-conflict', conflicts? }
    } catch (err) {
      return HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }

    // Conflit : le merge a été annulé côté service, rien à reconstruire
    if (result.status === 'conflict') {
      return HttpErrorHandler.gitMethodError(req, res, formatConflictMessage(result.conflicts || []))
    }

    try {
      await buildProject(projectPath, projectId, userId, getRootId(projectId))

      // CLSI (www-data) doit pouvoir recréer son cache : on supprime le dossier de
      // compilation et le cache du projet pour qu'ils soient régénérés proprement.
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

      if (result.status === 'stash-conflict') {
        return HttpErrorHandler.gitMethodError(req, res,
          'Pull effectué, mais vos modifications locales non commitées étaient en conflit avec le dépôt distant et ont été écartées.')
      }
      res.sendStatus(200)
    } catch (error) {
      if (res.headersSent) return
      console.error("Erreur après le pull (buildProject):", error.message)
      HttpErrorHandler.gitMethodError(req, res, error?.message || String(error))
    }
  },

  async markDeleted(req, res) {
    const { projectId, filePath } = req.body
    if (!projectId || !filePath) return res.status(400).json({ error: 'projectId et filePath requis.' })
    if (!isSafeRelativePath(filePath)) return res.status(400).json({ error: 'filePath invalide.' })
    try {
      const project = await Project.findById(projectId, 'git').lean().exec()
      if (!project?.git?.linkedAt) return res.sendStatus(200) // projet non lié, rien à faire
      const existing = project.git.pendingDeletions || []
      if (!existing.includes(filePath)) {
        await Project.updateOne({ _id: projectId }, { $push: { 'git.pendingDeletions': filePath } })
      }
      res.sendStatus(200)
    } catch (err) {
      console.error('markDeleted error:', err.message)
      res.sendStatus(500)
    }
  },

  async add(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const filePath = req.body.filePath
    const deleted = req.body.deleted === true
    if (!isSafeRelativePath(filePath)) {
      return res.status(400).json({ error: 'filePath invalide.' })
    }
    if (!deleted) {
      try {
        await compileProject(projectId, userId)
        console.log("Compilation réussie avant le add")
      } catch (compileError) {
        console.log("Compilation échouée avant add, on utilise le dernier état compilé:", compileError.message)
      }
      try {
        await gitUpdate(projectId, userId, [filePath])
      } catch (error) {
        console.log("error when syncing in git add", error)
      }
    }

    try {
      const response = await fetch(`${GIT_SERVICE_URL}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, filePath, deleted }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
      }
      // Suppression indexée avec succès : la retirer des suppressions en attente.
      if (deleted) {
        await Project.updateOne({ _id: projectId }, { $pull: { 'git.pendingDeletions': filePath } }).catch(() => {})
      }
      res.sendStatus(200)
    } catch (err) {
      HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }
  },

  async commit(req, res) {
    const { projectId, userId, message } = req.body // userId = owner injecté par injectGitOwner
    if (!message || message.trim() === '') {
    return HttpErrorHandler.gitMethodError(req, res, 'Please add a commit message before committing.')
    }
    try {
    const response = await fetch(`${GIT_SERVICE_URL}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, message: message.trim() }),
    })
    if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
    }
    res.sendStatus(200)
    } catch (err) {
    HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }
  },

  async push(req, res) {
    const { projectId, userId } = req.body
    console.log("Pushing")
    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, gitInfo }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
      }
      res.sendStatus(200)
    } catch (err) {
      HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
    }
  },

  // Route pour obtenir l'historique des commits
  async commitHistory(req, res) {
    const { projectId, userId } = req.query
    const limit = req.query.limit || 10
    try {
      const response = await fetch(`${GIT_SERVICE_URL}/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, limit }),
      })
      if (!response.ok) return res.json([])
      res.json(await response.json())
    } catch (error) {
      console.error("Error fetching commit history:", error)
      res.json([])
    }
  },

  // Route pour effectuer un rollback
  async rollback(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const commitHash = req.body.commitHash
    const projectPath = dataPath + projectId + "-" + userId

    console.log(`Rolling back to commit ${commitHash}`)
    if (!commitHash || !commitHash.trim()) {
      return res.status(400).json({ error: "No commit hash provided" })
    }

    try {
      const response = await fetch(`${GIT_SERVICE_URL}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, commitHash }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return res.status(500).json({ success: false, error: text || `git service: ${response.status}` })
      }
      // reset --hard a changé le working tree → reconstruire l'éditeur "from scratch"
      await rebuildProjectAfterRollback(projectPath, projectId, userId)
      res.json({ success: true, message: 'Rollback and rebuild successful' })
    } catch (error) {
      console.error("Error during rollback:", error)
      res.status(500).json({ success: false, error: error.message || 'Rollback failed' })
    }
  },

  async stagedFiles(req, res) {
    const { projectId, userId } = req.query
    try {
      const response = await fetch(`${GIT_SERVICE_URL}/staged`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId }),
      })
      if (!response.ok) return res.json([])
      res.json(await response.json())
    } catch (error) {
      console.error("Error:", error)
      res.json([])
    }
  },

  // Hybride : le service renvoie la partie git (modifiés/non suivis + nouveaux fichiers
  // de compiles/ + liste des fichiers suivis) ; web y ajoute les entités Overleaf non
  // suivies (docstore/filestore) et les suppressions en attente (Mongo).
  async notStagedFiles(req, res) {
    const { projectId, userId } = req.query
    try {
      const response = await fetch(`${GIT_SERVICE_URL}/not-staged`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId }),
      })
      if (!response.ok) return res.json({ notStaged: [], deleted: [] })
      const { notStaged, tracked } = await response.json()
      const trackedSet = new Set(tracked || [])
      const listed = new Set(notStaged)

      // Entités Overleaf (docs + binaires) non suivies par git et pas déjà listées
      try {
        const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
        for (const { path: filePath } of [...docs, ...files]) {
          const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath
          if (!trackedSet.has(normalized) && !listed.has(normalized)) {
            notStaged.push(normalized)
            listed.add(normalized)
          }
        }
      } catch (e) {
        console.log('getAllEntities échoué:', e.message)
      }

      // Suppressions en attente
      const project = await Project.findById(projectId, 'git.pendingDeletions').lean().exec()
      const deleted = project?.git?.pendingDeletions || []

      res.json({ notStaged, deleted })
    } catch (error) {
      console.error("Error:", error)
      res.json({ notStaged: [], deleted: [] })
    }
  },

  async currentBranch(req, res) {
    const { projectId, userId } = req.query
    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/current-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, gitInfo }),
      })
      if (!response.ok) return res.json("")
      res.json(await response.json())
    } catch (error) {
      console.error("Error fetching current Branch:", error)
      res.json("")
    }
  },

  async branches(req, res) {
    const { projectId, userId } = req.query
    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, gitInfo }),
      })
      if (!response.ok) return res.json([])
      res.json(await response.json())
    } catch (error) {
      console.error("Error fetching branches:", error)
      res.json([])
    }
  },

  async switch_branch(req, res) {
    const { projectId, userId, branchName } = req.body
    const projectPath = dataPath + projectId + "-" + userId
    console.log("switch branch to:", branchName)

    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, ref: branchName, gitInfo }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
      }
      // Mémoriser la branche courante en base pour que push/pull ciblent la bonne branche
      const localBranch = branchName.startsWith('origin/') ? branchName.slice('origin/'.length) : branchName
      await Project.updateOne({ _id: projectId }, { $set: { 'git.branch': localBranch } }).exec()
      // Le working tree a changé de branche → reconstruire l'éditeur Overleaf
      await buildProject(projectPath, projectId, userId, getRootId(projectId))
      resyncHistory(projectId) // arrière-plan : ne bloque pas la réponse
      res.sendStatus(200)
    } catch (error) {
      console.error("Git checkout failed:", error)
      HttpErrorHandler.gitMethodError(req, res, error?.message || String(error))
    }
  },

  async createBranch(req, res) {
    const { projectId, userId, newBranchName } = req.body
    try {
      const gitInfo = await getGitInfo(projectId)
      const response = await fetch(`${GIT_SERVICE_URL}/create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, newBranchName, gitInfo }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return HttpErrorHandler.gitMethodError(req, res, text || `git service: ${response.status}`)
      }
      // checkoutLocalBranch bascule sur la nouvelle branche → la mémoriser en base
      await Project.updateOne({ _id: projectId }, { $set: { 'git.branch': newBranchName } }).exec()
      // Créer une branche ne change pas le contenu du working tree → pas de rebuild
      res.sendStatus(200)
    } catch (error) {
      console.error("Create branch failed:", error)
      HttpErrorHandler.gitMethodError(req, res, error?.message || String(error))
    }
  },

  getKey(req, res) {
    // La clé SSH est propre à l'utilisateur : on dérive l'identité de la session,
    // jamais d'un paramètre fourni par le client (évite l'IDOR et le path traversal).
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!userId) return res.sendStatus(401)
    getKey(userId, 'public')
      .then((publicKeyValue) => {
        res.send(publicKeyValue)
      })
      .catch((err) => {
        HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
      })
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
      const { notStaged: newFiles, deleted: deletedFiles } = await getNotStaged(projectId, userId)
      await gitUpdate(projectId, userId, newFiles)
      // Supprimer du working tree les fichiers supprimés dans Overleaf
      const repoPath = dataPath + projectId + "-" + userId
      for (const f of deletedFiles) {
        if (!isSafeRelativePath(f)) continue // ignore tout chemin non confiné au dépôt
        const fullPath = path.join(repoPath, f)
        try {
          if (await fs.pathExists(fullPath)) await fs.remove(fullPath)
        } catch (_) {}
      }
      await git.add('.')
      if (deletedFiles.length > 0) {
        await Project.updateOne({ _id: projectId }, { $set: { 'git.pendingDeletions': [] } }).catch(() => {})
      }
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

module.exports = {GitController, gitClone, gitUpdate, gitInit, setProjectIdParam, injectGitOwner}
