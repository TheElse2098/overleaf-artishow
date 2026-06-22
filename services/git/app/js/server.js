import http from 'node:http'
import express from 'express'
import logger from '@overleaf/logger'
import metrics from '@overleaf/metrics'
import { commit, pull, push } from './GitController.js'

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
  //app.post('/checkout', checkout)

  const server = http.createServer(app)
  return { app, server }
}
