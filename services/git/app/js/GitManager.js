import simpleGit from 'simple-git'
import fs from 'fs-extra'
import crypto from 'node:crypto'
import sshpk from 'sshpk'
import path from 'node:path'


const DATA_PATH = '/var/lib/overleaf/data/git/'
const OUTPUT_PATH = '/var/lib/overleaf/data/compiles/'
const BANNED_FILES = ['output.aux', 'output.fdb_latexmk', 'output.fls', 'output.log', 'output.pdf', 'output.stdout', 'output.stderr', 'output.synctex.gz', '.project-sync-state']

// Extensions générées par une compilation LaTeX (artefacts à ne jamais suivre).
// NB : .pdf n'y est PAS — un .pdf peut être une figure légitime du projet. Seul
// le PDF de sortie (output.pdf, dans BANNED_FILES) est traité comme un artefact.
const COMPILATION_EXTENSIONS = new Set([
  '.aux', '.bbl', '.bcf', '.blg', '.fdb_latexmk', '.fls', '.idx', '.ilg',
  '.ind', '.lof', '.log', '.lot', '.nav', '.out', '.run.xml', '.snm',
  '.synctex', '.synctex.gz', '.toc', '.vrb', '.xdv', '.dvi', '.fmt',
  '.stdout', '.stderr',
])

// Détecte un artefact de compilation par son chemin relatif (POSIX, séparateur "/").
// Couvre : les fichiers bannis exacts, toute extension LaTeX générée, le synctex
// "busy", et les dossiers d'outils (_minted-*, .texpadtmp, etc.).
function isCompilationArtifact(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false
  const base = relPath.split('/').pop()
  if (BANNED_FILES.includes(base)) return true
  if (base === '.project-sync-state' || base.endsWith('.synctex(busy)')) return true
  // Dossiers d'auxiliaires : tout segment _minted-* ou .*tmp dans le chemin
  if (relPath.split('/').some(seg => seg.startsWith('_minted') || seg === '.texpadtmp')) {
    return true
  }
  const dot = base.indexOf('.')
  if (dot < 0) return false
  // ".synctex.gz" / ".run.xml" sont des doubles extensions → tester le suffixe complet
  const ext = base.slice(dot).toLowerCase()
  if (COMPILATION_EXTENSIONS.has(ext)) return true
  const lastExt = base.slice(base.lastIndexOf('.')).toLowerCase()
  return COMPILATION_EXTENSIONS.has(lastExt)
}

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
// tokenType 'github' → x-access-token, 'gitlab' → oauth2,
// 'other' → token brut comme userinfo (l'utilisateur peut entrer "token" seul ou
// "utilisateur:token" pour les fournisseurs qui exigent un nom d'utilisateur).
function buildAuthenticatedUrl(remoteUrl, token, tokenType) {
  const sshPattern = /^git@([^:]+):(.+\.git)$/
  const match = remoteUrl.match(sshPattern)
  if (tokenType === 'other') {
    if (match) return `https://${token}@${match[1]}/${match[2]}`
    try {
      const url = new URL(remoteUrl)
      return `${url.protocol}//${token}@${url.host}${url.pathname}${url.search}`
    } catch {
      return remoteUrl
    }
  }
  const username = tokenType === 'gitlab' ? 'oauth2' : 'x-access-token'
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


// Masque les credentials (//user:pass@) dans un message d'erreur git
function sanitizeGitError(err) {
  const msg = err?.message || String(err)
  return msg.replace(/\/\/[^@/\s]+:[^@/\s]+@/g, '//***:***@')
}

// Valide le schéma d'une URL git (anti transport ext::/file:// → exécution de commande)
function isSafeGitUrl(url) {
  if (typeof url !== 'string') return false
  return /^git@[^:\s]+:.+$/.test(url) ||
    /^https:\/\/\S+$/.test(url) ||
    /^git:\/\/\S+$/.test(url) ||
    /^ssh:\/\/\S+$/.test(url)
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

// File d'attente pour sérialiser les opérations SSH (évite la course sur process.env)
let sshChain = Promise.resolve()

// Exécute fn() avec GIT_SSH_COMMAND positionné dans process.env (ambiant — toléré par simple-git,
// contrairement à .env() qui est bloqué). Sérialisé : aucune autre opération SSH ne peut changer
// la clé pendant l'exécution → plus de course inter-utilisateurs.
function withSshKey(userId, fn) {
  const run = async () => {
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
  const result = sshChain.then(run, run)
  sshChain = result.catch(() => {}) // ne casse pas la chaîne en cas d'erreur
  return result
}

// Choisit l'authentification distante puis exécute fn(remote).
// - token → URL HTTPS authentifiée ; sinon → clé SSH (process.env ambiant, sérialisé)
// Les erreurs sont assainies pour ne jamais laisser fuiter le token.
async function withRemoteAuth(git, userId, gitInfo, fn) {
  try {
    if (gitInfo?.token && gitInfo?.remoteUrl) {
      const authUrl = buildAuthenticatedUrl(gitInfo.remoteUrl, gitInfo.token, gitInfo.tokenType)
      return await fn(authUrl)
    }
    return await withSshKey(userId, () => fn('origin'))
  } catch (e) {
    throw new Error(sanitizeGitError(e))
  }
}

// Empêche git de convertir les fins de ligne (corruption des fichiers binaires)
async function disableBinaryConversion(repoPath) {
  await fs.ensureDir(path.join(repoPath, '.git', 'info'))
  await fs.writeFile(path.join(repoPath, '.git', 'info', 'attributes'), '* -text\n', 'utf8')
}

// Contenu du .gitignore écrit à l'init : artefacts de compilation LaTeX.
// Garde le PDF de sortie ignoré aussi (output.pdf est un artefact, pas une source).
const LATEX_GITIGNORE = `# LaTeX build artifacts (auto-generated by Overleaf)
*.aux
*.bbl
*.bcf
*.blg
*.dvi
*.fdb_latexmk
*.fls
*.idx
*.ilg
*.ind
*.lof
*.log
*.lot
*.nav
*.out
*.run.xml
*.snm
*.synctex
*.synctex.gz
*.synctex(busy)
*.toc
*.vrb
*.xdv
*.fmt
output.*
.project-sync-state
_minted-*/
.texpadtmp/
`

// Écrit (sans écraser un .gitignore existant) le .gitignore d'artefacts LaTeX.
async function writeLatexGitignore(repoPath) {
  const gitignorePath = path.join(repoPath, '.gitignore')
  if (await fs.pathExists(gitignorePath)) return
  await fs.writeFile(gitignorePath, LATEX_GITIGNORE, 'utf8')
}

// Ré-extrait les fichiers de HEAD (pour appliquer les attributs binaires).
// Tolère une branche/dépôt sans fichier (commit initial vide) : rien à ré-extraire.
async function recheckoutHead(git) {
  try {
    await git.raw(['checkout', 'HEAD', '--', '.'])
  } catch (e) {
    if (!/did not match any file/i.test(e?.message || '')) throw e
  }
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
    await withRemoteAuth(git, userId, gitInfo, remote =>
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

    const result = await withRemoteAuth(git, userId, gitInfo, remote =>
    git.pull(remote, gitInfo?.branch || null, { '--no-rebase': null })
    )

    //conflicts

    if (result.conflicts && result.conflicts.length > 0) {
        // On NE fait PLUS merge --abort : on laisse le working tree dans l'état
        // conflicté (marqueurs <<<<<<< ======= >>>>>>> dans les fichiers, MERGE_HEAD
        // présent). web reconstruira l'éditeur avec ces marqueurs pour que
        // l'utilisateur résolve dans Overleaf, puis appelle resolveMerge / abortMerge.
        //
        // Le stash local pré-pull complique la chose : le repop pourrait empiler un
        // 2e conflit. On le pop quand même pour que les modifs locales soient dans le
        // working tree à résoudre ; en cas d'échec on le garde (l'utilisateur le
        // récupère via abortMerge).
        if (stashed) {
            try { await git.stash(['pop']) } catch (_) {}
        }
        let conflicted = result.conflicts
        try {
            const s = await git.status()
            if (s.conflicted && s.conflicted.length > 0) conflicted = s.conflicted
        } catch (_) {}
        return { status: 'conflict', conflicts: conflicted }
    }

    //checkout HEAD

    await recheckoutHead(git)

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

// Un merge est-il en cours (conflit non encore résolu) ? Source de vérité = git.
export async function mergeInProgress(projectId, userId) {
  const repoPath = DATA_PATH + projectId + '-' + userId
  return fs.pathExists(path.join(repoPath, '.git', 'MERGE_HEAD'))
}

// Scanne les fichiers (encore) en conflit et y repère les marqueurs de conflit
// git laissés. Renvoie, par fichier, les lignes contenant un marqueur — pour
// AVERTIR l'utilisateur sans le bloquer (un "<<<<<<<" peut être voulu).
async function findConflictMarkers(git, repoPath) {
  const markerRe = /^(<{7}|={7}|>{7})(\s|$)/
  const warnings = []
  let files = []
  try {
    files = (await git.status()).conflicted || []
  } catch (_) {}
  for (const rel of files) {
    const full = path.join(repoPath, rel)
    let content
    try { content = await fs.readFile(full, 'utf8') } catch (_) { continue }
    const lines = content.split(/\r?\n/)
    const hits = []
    lines.forEach((line, i) => {
      if (markerRe.test(line)) hits.push({ line: i + 1, marker: line.slice(0, 7) })
    })
    if (hits.length > 0) warnings.push({ path: rel, markers: hits })
  }
  return warnings
}

// Liste les fichiers actuellement en conflit (pour l'affichage côté UI).
export async function conflictedFiles(projectId, userId) {
  const git = getGitForProject(projectId, userId)
  try {
    return (await git.status()).conflicted || []
  } catch (_) {
    return []
  }
}

// Finalise un merge : indexe tout et commite. NE bloque PAS s'il reste des
// marqueurs — il les renvoie en avertissement (markerWarnings) et commite quand
// même, car un marqueur peut être du contenu légitime que l'utilisateur a gardé.
export async function resolveMerge(projectId, userId, message) {
  const git = getGitForProject(projectId, userId)
  const repoPath = DATA_PATH + projectId + '-' + userId

  if (!(await mergeInProgress(projectId, userId))) {
    return { status: 'no-merge' }
  }

  const markerWarnings = await findConflictMarkers(git, repoPath)

  await git.add('.')
  await git.addConfig('user.name', 'overleaf')
  await git.addConfig('user.email', 'overleaf@overleaf.com')
  // Commit du merge. Avec un merge en cours, git prend le message MERGE_MSG si on
  // n'en passe pas ; ici on fournit le nôtre.
  await git.commit(message || 'Merge: résolution des conflits')

  return { status: 'resolved', markerWarnings }
}

// Filet de sécurité : abandonne le merge en cours et revient à l'état d'avant pull.
export async function abortMerge(projectId, userId) {
  const git = getGitForProject(projectId, userId)
  if (!(await mergeInProgress(projectId, userId))) {
    return { status: 'no-merge' }
  }
  await git.merge(['--abort'])
  return { status: 'aborted' }
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

// Désindexe un fichier : git reset HEAD -- <file>. Ne touche pas au working tree
// (le contenu reste, le fichier repasse simplement en "non indexé").
// `--` sépare les options des chemins (anti-injection d'argument si filePath commence par "-").
export async function unstage(projectId, userId, filePath) {
  const git = getGitForProject(projectId, userId)
  await git.raw(['reset', '-q', 'HEAD', '--', filePath])
}

// Désindexe tout : git reset HEAD (remet l'index à HEAD, working tree intact).
export async function unstageAll(projectId, userId) {
  const git = getGitForProject(projectId, userId)
  await git.raw(['reset', '-q', 'HEAD'])
}

// Indexe tout : retire du working tree les fichiers supprimés dans Overleaf, puis git add .
export async function addAll(projectId, userId, deletedFiles = []) {
  const git = getGitForProject(projectId, userId)
  const repoPath = DATA_PATH + projectId + '-' + userId

  for (const f of deletedFiles) {
    // confiné au dépôt (anti path traversal)
    if (typeof f !== 'string' || path.isAbsolute(f) || f.split(/[/\\]+/).includes('..')) continue
    const fullPath = path.join(repoPath, f)
    try { if (await fs.pathExists(fullPath)) await fs.remove(fullPath) } catch (_) {}
  }
  await git.add('.')
}

export async function checkout(projectId, userId, ref, gitInfo) {
  const git = getGitForProject(projectId, userId)
  const repoPath = DATA_PATH + projectId + '-' + userId

  // Récupérer les refs distantes (auth token ou clé SSH)
  await withRemoteAuth(git, userId, gitInfo, remote => git.fetch(remote))

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
  await recheckoutHead(git)
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
  await withRemoteAuth(git, userId, gitInfo, remote =>
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
  return withRemoteAuth(git, userId, gitInfo, async remote => {
    // git.raw : ordre explicite des arguments. Indispensable quand `remote` est une
    // URL authentifiée (token) — git.fetch(remote, [refspec]) de simple-git mélange
    // l'ordre et git prend le refspec pour le dépôt.
    await git.raw(['fetch', remote, '+refs/heads/*:refs/remotes/origin/*', '--prune'])
    const branches = await git.branch(['-r'])
    return branches.all
  })
}

export async function getCurrentBranch(projectId, userId, gitInfo) {
  const git = getGitForProject(projectId, userId)
  return withRemoteAuth(git, userId, gitInfo, async remote => {
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
        if (item.startsWith('_minted') || item === '.texpadtmp') continue
        await recurse(fullPath)
      } else {
        if (isCompilationArtifact(relPath)) continue
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
  const modifiedFiles = status.files
    .filter(f => f.working_dir !== ' ' && f.working_dir !== 'D' && f.index === ' ')
    .map(f => f.path)
    .filter(p => !isCompilationArtifact(p))
  const untrackedFiles = status.files
    .filter(f => f.working_dir === '?' && f.index === '?')
    .map(f => f.path)
    .filter(p => !isCompilationArtifact(p))
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
  // Refuser tout transport non standard (ext::, file://…) → anti exécution de commande
  if (!isSafeGitUrl(link)) {
    throw new Error('URL de dépôt non autorisée.')
  }

  const repoPath = DATA_PATH + projectId + '-' + ownerId
  await fs.ensureDir(repoPath)

  // --no-checkout : cloner sans extraire les fichiers pour écrire les attributs binaires d'abord
  const cloneOptions = ['--no-checkout']
  if (branch) cloneOptions.push('--branch', branch)

  const newGit = () => simpleGit({ baseDir: DATA_PATH, config: ['core.autocrlf=false', 'core.eol=lf'] })

  try {
    if (token) {
      const authUrl = buildAuthenticatedUrl(link, token, tokenType)
      await newGit().clone(authUrl, repoPath, cloneOptions)
      console.log("Repository cloned via HTTPS token (no checkout)")
    } else {
      // Clé SSH via process.env ambiant, sérialisé (withSshKey)
      await withSshKey(ownerId, () => newGit().clone(link, repoPath, cloneOptions))
      console.log("Repository cloned via SSH (no checkout)")
    }
  } catch (e) {
    throw new Error(sanitizeGitError(e))
  }

  // Écrire les attributs binaires AVANT le checkout pour éviter la corruption des binaires
  await disableBinaryConversion(repoPath)
  await recheckoutHead(getGitForProject(projectId, ownerId))
  console.log("Initial checkout done with binary attributes applied")
}

// ── Init & SetRemote ──────────────────────────────────────────────────────────

// Vérifie si un repo git existe sur disque (pas de MongoDB — pur fichiers)
export async function isGitRepo(projectId, ownerId) {
  const repoPath = DATA_PATH + projectId + '-' + ownerId
  return fs.pathExists(path.join(repoPath, '.git'))
}

// Initialise un repo git local, configure le remote et tente un push initial.
export async function gitInit(projectId, ownerId, remoteUrl = null, defaultBranch = 'main', token = null, tokenType = null) {
  const repoPath = DATA_PATH + projectId + '-' + ownerId
  await fs.ensureDir(repoPath)

  const alreadyRepo = await isGitRepo(projectId, ownerId)
  if (alreadyRepo) return { created: false, remoteLinked: false }

  const localGit = simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'],
  })

  await localGit.init()
  await localGit.addConfig('user.name', 'overleaf')
  await localGit.addConfig('user.email', 'overleaf@overleaf.com')
  await disableBinaryConversion(repoPath)
  // Ignorer les artefacts de compilation LaTeX dès le départ, pour qu'ils
  // n'apparaissent jamais comme fichiers à indexer ni ne soient poussés.
  await writeLatexGitignore(repoPath)
  await localGit.add('.gitignore')
  await localGit.commit('Initial commit')
  try { await localGit.raw(['branch', '-M', defaultBranch]) } catch (_) {}

  let remoteLinked = false
  if (remoteUrl) {
    if (!isSafeGitUrl(remoteUrl)) throw new Error('URL remote invalide.')
    await localGit.addRemote('origin', remoteUrl)

    const tryPush = async () => {
      if (token) {
        const authUrl = buildAuthenticatedUrl(remoteUrl, token, tokenType)
        await localGit.push(authUrl, defaultBranch, ['--set-upstream'])
      } else {
        await withSshKey(ownerId, () => localGit.push(['-u', 'origin', defaultBranch]))
      }
    }

    try {
      await tryPush()
      remoteLinked = true
    } catch (_) {
      // Remote non vide : fusionner les historiques puis repousser
      try {
        if (token) {
          const authUrl = buildAuthenticatedUrl(remoteUrl, token, tokenType)
          await localGit.raw(['pull', authUrl, defaultBranch, '--allow-unrelated-histories', '--no-rebase'])
        } else {
          await withSshKey(ownerId, () =>
            localGit.raw(['pull', 'origin', defaultBranch, '--allow-unrelated-histories', '--no-rebase'])
          )
        }
        await tryPush()
        remoteLinked = true
      } catch (mergeErr) {
        console.error('Push initial échoué après merge:', sanitizeGitError(mergeErr))
      }
    }
  }

  return { created: true, remoteLinked }
}

// Lie un remote à un repo local existant et tente un push.
export async function gitSetRemote(projectId, ownerId, remoteUrl, branch = 'main', token = null, tokenType = null) {
  if (!isSafeGitUrl(remoteUrl)) throw new Error('URL remote invalide.')

  const repoPath = DATA_PATH + projectId + '-' + ownerId
  const localGit = simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'],
  })

  try { await localGit.removeRemote('origin') } catch (_) {}
  await localGit.addRemote('origin', remoteUrl)

  const tryPush = async () => {
    if (token) {
      const authUrl = buildAuthenticatedUrl(remoteUrl, token, tokenType)
      await localGit.push(authUrl, branch, ['--set-upstream'])
    } else {
      await withSshKey(ownerId, () => localGit.push(['-u', 'origin', branch]))
    }
  }

  let remoteLinked = false
  try {
    await tryPush()
    remoteLinked = true
  } catch (_) {
    try {
      if (token) {
        const authUrl = buildAuthenticatedUrl(remoteUrl, token, tokenType)
        await localGit.raw(['pull', authUrl, branch, '--allow-unrelated-histories', '--no-rebase'])
      } else {
        await withSshKey(ownerId, () =>
          localGit.raw(['pull', 'origin', branch, '--allow-unrelated-histories', '--no-rebase'])
        )
      }
      await tryPush()
      remoteLinked = true
    } catch (mergeErr) {
      console.error('SetRemote push échoué après merge:', sanitizeGitError(mergeErr))
    }
  }

  return { remoteLinked }
}

// Supprime le remote "origin" d'un repo local existant (no-op s'il n'existe pas).
export async function gitRemoveRemote(projectId, ownerId) {
  const repoPath = DATA_PATH + projectId + '-' + ownerId
  const localGit = simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'],
  })

  try { await localGit.removeRemote('origin') } catch (_) {}
}
