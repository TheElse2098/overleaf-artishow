import http from 'node:http'
import express from 'express'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import { commit, pull, push, add, checkout, rollback, createBranch, staged, notStaged, branches, currentBranch, commitHistory } from './GitController.js'

logger.initialize('git')           // nomme le service dans les logs

export async function createServer() {
  const app = express()
  app.use(express.json())          // pour lire les body JSON
  app.use(metrics.http.monitor(logger))

  app.get('/health_check', (req, res) => res.sendStatus(200))
  app.post('/commit', commit)      // routes git
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

  const server = http.createServer(app)
  return { app, server }
}
