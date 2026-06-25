import logger from '@overleaf/logger'
import path from 'node:path'
import * as GitManager from './GitManager.js'

// Traduit la sortie brute de git (multi-lignes, "remote:", "fatal:", URLs…) en
// un message court et lisible pour l'UI. On teste des motifs connus dans l'ordre
// et on retombe sur un message générique nettoyé si rien ne correspond.
const GIT_ERROR_RULES = [
  {
    test: /authentication failed|invalid username or token|could not read username|password authentication is not supported/i,
    message:
      "Authentification échouée : vérifiez votre token d'accès et ses droits sur le dépôt.",
  },
  {
    test: /permission denied|403 forbidden|access denied|not authorized/i,
    message:
      "Accès refusé : votre compte n'a pas les droits nécessaires sur ce dépôt.",
  },
  {
    test: /could not resolve host|couldn'?t resolve|name or service not known|failed to connect|connection (refused|timed out)|network is unreachable/i,
    message:
      'Impossible de joindre le dépôt distant : vérifiez l’URL et votre connexion réseau.',
  },
  {
    test: /not a git repository|fatal: not a git repository/i,
    message:
      'Ce projet n’est pas encore lié à un dépôt Git. Importez ou configurez un dépôt distant avant de lancer une opération Git.',
  },
  {
    test: /repository not found|does not (appear to be a git repository|exist)|not found/i,
    message:
      'Dépôt introuvable : vérifiez l’URL du dépôt distant.',
  },
  {
    test: /\bconflict\b|automatic merge failed|fix conflicts|needs merge/i,
    message:
      'Conflit détecté : résolvez les conflits avant de continuer.',
  },
  {
    test: /rejected.*non-fast-forward|fetch first|tip of your current branch is behind/i,
    message:
      'Push rejeté : le dépôt distant contient des changements. Faites un pull avant de pusher.',
  },
  {
    test: /nothing to commit|no changes added/i,
    message: 'Aucun changement à valider.',
  },
  {
    test: /pathspec .* did not match|unknown revision|invalid reference|not a valid (ref|object) name/i,
    message:
      'Référence introuvable : cette branche ou ce commit n’existe pas.',
  },
  {
    test: /\bdiverged\b|have diverged/i,
    message:
      'Les historiques local et distant ont divergé : faites un pull pour les réconcilier.',
  },
]

function humanizeGitError(err) {
  const raw = (err?.message || String(err) || '').trim()
  for (const rule of GIT_ERROR_RULES) {
    if (rule.test.test(raw)) {
      return rule.message
    }
  }
  // Repli : on prend la dernière ligne "fatal:" si elle existe, sinon un message
  // générique — jamais le pavé multi-lignes brut.
  const fatal = raw.split(/\r?\n/).find(l => /^fatal:/i.test(l.trim()))
  if (fatal) {
    return 'Erreur Git : ' + fatal.replace(/^fatal:\s*/i, '').trim()
  }
  return "Une erreur Git est survenue. Réessayez ou vérifiez la configuration du dépôt."
}

// Réponse d'erreur uniforme pour tous les handlers : log de l'erreur brute
// (pour le debug), message lisible pour le client.
function sendGitError(res, err, context, meta = {}) {
  logger.error({ err, ...meta }, context)
  res.status(500).json({ error: humanizeGitError(err) })
}

export async function commit(req, res) {
  const { projectId, userId, message } = req.body

  // validation des entrées
  if (!projectId || !userId) {
    return res.status(400).json({ error: 'projectId et userId requis.' })
  }
  if (!message || message.trim() === '') {
    return res.status(400).json({ error: 'message de commit vide.' })
  }

  try {
    await GitManager.commit(projectId, userId, message.trim())
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git commit failed', { projectId })
  }
}

export async function push(req,res) {
  const { projectId, userId, gitInfo } = req.body

  if (!projectId || !userId || !gitInfo) {
    return res.status(400).json({ error: 'projectId, userId, gitInfo requis.' })
  }

  try {
    await GitManager.push(projectId, userId, gitInfo)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git push failed', { projectId })
  }

}

export async function pull(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    const result = await GitManager.pull(projectId, userId, gitInfo)
    res.json(result)              // { status: 'ok' | 'conflict' | 'stash-conflict', conflicts? }
  } catch (err) {
    sendGitError(res, err, 'git pull failed', { projectId })
  }
}


function isSafeRelativePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false
  if (path.isAbsolute(filePath)) return false
  return !filePath.split(/[/\\]+/).some(segment => segment === '..')
}


export async function add(req, res) {
  const { projectId, userId, filePath, deleted } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  if (!isSafeRelativePath(filePath)) return res.status(400).json({ error: 'filePath invalide.' })
  try {
    await GitManager.add(projectId, userId, filePath, deleted === true)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git add failed', { projectId })
  }
}

// Valide une réf git (branche "origin/xxx" ou hash de commit) : pas de segment
// commençant par "-" (anti-injection d'argument), pas de segment vide.
function isSafeRef(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  return !name.split('/').some(seg => seg.startsWith('-') || seg === '')
}

export async function checkout(req, res) {
  const { projectId, userId, ref, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  if (!isSafeRef(ref)) return res.status(400).json({ error: 'ref invalide.' })
  try {
    await GitManager.checkout(projectId, userId, ref, gitInfo)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git checkout failed', { projectId })
  }
}

export async function rollback(req, res) {
  const { projectId, userId, commitHash } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  if (!commitHash || !commitHash.trim()) return res.status(400).json({ error: 'commitHash requis.' })
  try {
    await GitManager.rollback(projectId, userId, commitHash)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git rollback failed', { projectId })
  }
}

export async function createBranch(req, res) {
  const { projectId, userId, newBranchName, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  if (!isSafeRef(newBranchName)) return res.status(400).json({ error: 'newBranchName invalide.' })
  try {
    await GitManager.createBranch(projectId, userId, newBranchName, gitInfo)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git createBranch failed', { projectId })
  }
}

export async function staged(req, res) {
  const { projectId, userId } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getStaged(projectId, userId))
  } catch (err) {
    sendGitError(res, err, 'git staged failed', { projectId })
  }
}

export async function notStaged(req, res) {
  const { projectId, userId } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.notStaged(projectId, userId))
  } catch (err) {
    sendGitError(res, err, 'git notStaged failed', { projectId })
  }
}

export async function branches(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getBranches(projectId, userId, gitInfo))
  } catch (err) {
    sendGitError(res, err, 'git branches failed', { projectId })
  }
}

export async function currentBranch(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getCurrentBranch(projectId, userId, gitInfo))
  } catch (err) {
    sendGitError(res, err, 'git currentBranch failed', { projectId })
  }
}

export async function commitHistory(req, res) {
  const { projectId, userId, limit } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getCommitHistory(projectId, userId, parseInt(limit) || 10))
  } catch (err) {
    sendGitError(res, err, 'git commitHistory failed', { projectId })
  }
}

export async function gitClone(req, res) {
  const {projectId, ownerId, link, branch, token, tokenType} = req.body
  try {
    await GitManager.gitClone(projectId, ownerId, link, branch, token, tokenType)
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'gitClone failed', { projectId })
  }
}

export async function addAll(req, res) {
  const { projectId, userId, deletedFiles } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    await GitManager.addAll(projectId, userId, Array.isArray(deletedFiles) ? deletedFiles : [])
    res.sendStatus(200)
  } catch (err) {
    sendGitError(res, err, 'git addAll failed', { projectId })
  }
}