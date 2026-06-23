import logger from '@overleaf/logger'
import path from 'node:path'
import * as GitManager from './GitManager.js'

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
    logger.error({ err, projectId }, 'git commit failed')
    res.status(500).json({ error: err.message })
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
    logger.error({ err, projectId }, 'git push failed')
    res.status(500).json({ error: err.message })
  }

}

export async function pull(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    const result = await GitManager.pull(projectId, userId, gitInfo)
    res.json(result)              // { status: 'ok' | 'conflict' | 'stash-conflict', conflicts? }
  } catch (err) {
    logger.error({ err, projectId }, 'git pull failed')
    res.status(500).json({ error: err.message })
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
    logger.error({ err, projectId }, 'git add failed')
    res.status(500).json({ error: err.message })
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
    logger.error({ err, projectId }, 'git checkout failed')
    res.status(500).json({ error: err.message })
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
    logger.error({ err, projectId }, 'git rollback failed')
    res.status(500).json({ error: err.message })
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
    logger.error({ err, projectId }, 'git createBranch failed')
    res.status(500).json({ error: err.message })
  }
}


export async function staged(req, res) {
  const { projectId, userId } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getStaged(projectId, userId))
  } catch (err) {
    logger.error({ err, projectId }, 'git staged failed')
    res.status(500).json({ error: err.message })
  }
}

export async function notStaged(req, res) {
  const { projectId, userId } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.notStaged(projectId, userId))
  } catch (err) {
    logger.error({ err, projectId }, 'git notStaged failed')
    res.status(500).json({ error: err.message })
  }
}

export async function branches(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getBranches(projectId, userId, gitInfo))
  } catch (err) {
    logger.error({ err, projectId }, 'git branches failed')
    res.status(500).json({ error: err.message })
  }
}

export async function currentBranch(req, res) {
  const { projectId, userId, gitInfo } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getCurrentBranch(projectId, userId, gitInfo))
  } catch (err) {
    logger.error({ err, projectId }, 'git currentBranch failed')
    res.status(500).json({ error: err.message })
  }
}

export async function commitHistory(req, res) {
  const { projectId, userId, limit } = req.body
  if (!projectId || !userId) return res.status(400).json({ error: 'projectId et userId requis.' })
  try {
    res.json(await GitManager.getCommitHistory(projectId, userId, parseInt(limit) || 10))
  } catch (err) {
    logger.error({ err, projectId }, 'git commitHistory failed')
    res.status(500).json({ error: err.message })
  }
}
