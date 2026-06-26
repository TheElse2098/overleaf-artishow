import http from 'node:http'
import express from 'express'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import { commit, pull, push, add, checkout, rollback, createBranch, staged, notStaged, branches, currentBranch, commitHistory, gitClone, addAll, unstage, unstageAll, init, setRemote, removeRemote, mergeStatus, resolveMerge, abortMerge} from './GitController.js'

logger.initialize('git')       // nomme le service dans les logs

// Secret partagé avec web pour l'authentification inter-services
const SHARED_SECRET = process.env.GIT_SERVICE_SECRET || process.env.WEB_API_PASSWORD || 'password'

// Seul un appelant connaissant le secret web peut utiliser le service
function requireServiceAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== SHARED_SECRET) return res.sendStatus(401)
  next()
}

// Valide que les identifiants Mongo sont normaux (24 hex) → on ne peut pas remonter les dossiers
function validateIds(req, res, next) {
  for (const id of [req.body?.projectId, req.body?.userId, req.body?.ownerId]) {
    if (id != null && !/^[a-f0-9]{24}$/i.test(id)) {
      return res.status(400).json({ error: 'identifiant invalide.' })
    }
  }
  next()
}

export async function createServer() {
  const app = express()
  app.use(express.json())          // pour lire les body JSON
  app.use(metrics.http.monitor(logger))

  app.get('/health_check', (req, res) => res.sendStatus(200))

  // À partir d'ici, tout requiert le secret partagé + des identifiants valides
  app.use(requireServiceAuth)
  app.use(validateIds)

  // Routes git existantes
  app.post('/commit', commit)
  app.post('/pull', pull)
  app.post('/push', push)
  app.post('/add', add)
  app.post('/checkout', checkout)
  app.post('/rollback', rollback)
  app.post('/create-branch', createBranch)
  app.post('/staged', staged)
  app.post('/not-staged', notStaged)
  app.post('/branches', branches)
  app.post('/current-branch', currentBranch)
  app.post('/commits', commitHistory)
  app.post('/gitClone', gitClone)
  app.post('/add-all', addAll)
  app.post('/unstage', unstage)
  app.post('/unstage-all', unstageAll)
  app.post('/merge-status', mergeStatus)
  app.post('/resolve-merge', resolveMerge)
  app.post('/abort-merge', abortMerge)

  app.post('/init', init)
  app.post('/set-remote', setRemote)
  app.post('/remove-remote', removeRemote)

  const server = http.createServer(app)
  return { app, server }
}
