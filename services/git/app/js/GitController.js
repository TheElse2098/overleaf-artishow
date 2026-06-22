import logger from '@overleaf/logger'
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
