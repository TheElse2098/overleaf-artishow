// GitController.js — version "service" : web ne fait plus que de l'autorisation + proxy
// vers le service git. Seul `commit` est câblé pour l'instant ; le reste est stubbé
// afin que le service web démarre et que les routes s'enregistrent.
const Settings = require('@overleaf/settings')
const HttpErrorHandler = require('../Errors/HttpErrorHandler.mjs').default
const ProjectGetter = require('../Project/ProjectGetter.mjs').default

// URL du service git (résiliente : marche même sans entrée dans settings.defaults)
const GIT_SERVICE_URL =
  (Settings.apis && Settings.apis.gitService && Settings.apis.gitService.url) ||
  `http://${process.env.GIT_SERVICE_HOST || '127.0.0.1'}:3099`

// --- helpers d'autorisation (inchangés) ---
function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)
}

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

// Stub : handler pas encore migré vers le service git.
function notImplemented(req, res) {
  res.status(501).json({ error: 'Opération git pas encore disponible (migration en cours).' })
}

const GitController = {
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

  // --- stubs : à migrer ensuite, mais nécessaires pour que les routes s'enregistrent ---
  getKey: notImplemented,
  gitInfo: notImplemented,
  add: notImplemented,
  markDeleted: notImplemented,
  stagedFiles: notImplemented,
  notStagedFiles: notImplemented,
  currentBranch: notImplemented,
  branches: notImplemented,
  createBranch: notImplemented,
  pull: notImplemented,
  commitHistory: notImplemented,
  push: notImplemented,
  rollback: notImplemented,
  switch_branch: notImplemented,
  addAll: notImplemented,
  saveToken: notImplemented,
}

// Exports utilisés ailleurs (ProjectCreationHandler importe gitClone). Stubs pour le moment.
async function gitClone() {
  throw new Error('gitClone pas encore disponible (migration vers le service git en cours).')
}
async function gitUpdate() {}
async function gitInit() {
  throw new Error('gitInit pas encore disponible (migration vers le service git en cours).')
}

module.exports = { GitController, gitClone, gitUpdate, gitInit, setProjectIdParam, injectGitOwner }
