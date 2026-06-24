import http from 'node:http'
import express from 'express'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import {
  commit, pull, push, add, checkout, rollback, createBranch,
  staged, notStaged, branches, currentBranch, commitHistory, gitClone, addAll,
  gitInfo, init, setRemote,
} from './GitController.js'

logger.initialize('git')

const SHARED_SECRET = process.env.GIT_SERVICE_SECRET || process.env.WEB_API_PASSWORD || 'password'

function requireServiceAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== SHARED_SECRET) return res.sendStatus(401)
  next()
}

function validateIds(req, res, next) {
  const ids = [req.body?.projectId, req.body?.userId, req.body?.ownerId, req.query?.projectId]
  for (const id of ids) {
    if (id != null && !/^[a-f0-9]{24}$/i.test(id)) {
      return res.status(400).json({ error: 'identifiant invalide.' })
    }
  }
  next()
}

export async function createServer() {
  const app = express()
  app.use(express.json())
  app.use(metrics.http.monitor(logger))

  app.get('/health_check', (req, res) => res.sendStatus(200))

  app.use(requireServiceAuth)
  app.use(validateIds)

  // Routes git existantes
  app.post('/commit',         commit)
  app.post('/pull',           pull)
  app.post('/push',           push)
  app.post('/add',            add)
  app.post('/checkout',       checkout)
  app.post('/rollback',       rollback)
  app.post('/create-branch',  createBranch)
  app.post('/staged',         staged)
  app.post('/not-staged',     notStaged)
  app.post('/branches',       branches)
  app.post('/current-branch', currentBranch)
  app.post('/commits',        commitHistory)
  app.post('/gitClone',       gitClone)
  app.post('/add-all',        addAll)

  // Routes d'initialisation
  app.get('/git-info',        gitInfo)
  app.post('/init',           init)
  app.post('/set-remote',     setRemote)

  const server = http.createServer(app)
  return { app, server }
}