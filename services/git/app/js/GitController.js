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
