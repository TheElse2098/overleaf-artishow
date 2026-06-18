import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { expressify } from '@overleaf/promise-utils'
import logger from '@overleaf/logger'
import { getCollectionInternal } from '../../../../app/src/infrastructure/mongodb.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))
// modules/admin-user-stats/app/src -> services/web
const WEB_ROOT = Path.resolve(__dirname, '../../../../')
const SCRIPT_PATH = Path.join(WEB_ROOT, 'scripts/recompute_user_stats.mjs')

// Whitelist of fields the client is allowed to sort on (prevents arbitrary
// projections from being used as a sort key).
const SORTABLE_FIELDS = new Set([
  'email',
  'projectCount',
  'docSizeBytes',
  'fileSizeBytes',
  'totalSizeBytes',
  'lastProjectCreatedAt',
  'lastLoggedIn',
  'computedAt',
])
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Best-effort guard against launching several recomputes at once in a single
// web process; the rate limiter on the route is the real backstop.
let refreshRunning = false

async function getUserStatsCollection() {
  return await getCollectionInternal('userStats')
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderPage(req, res) {
  res.render(Path.resolve(__dirname, '../views/admin-user-stats'), {
    title: 'User Statistics',
  })
}

async function getData(req, res) {
  const userStats = await getUserStatsCollection()

  const page = Math.max(parseInt(req.query.page, 10) || 0, 0)
  const limit = Math.min(
    parseInt(req.query.limit, 10) || DEFAULT_LIMIT,
    MAX_LIMIT
  )
  const sortBy = SORTABLE_FIELDS.has(req.query.sortBy)
    ? req.query.sortBy
    : 'totalSizeBytes'
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1
  const search = (req.query.search || '').trim()

  const query = {}
  if (search) {
    query.email = { $regex: escapeRegExp(search), $options: 'i' }
  }

  const [rows, total] = await Promise.all([
    userStats
      .find(query)
      .sort({ [sortBy]: sortDir })
      .skip(page * limit)
      .limit(limit)
      .toArray(),
    userStats.countDocuments(query),
  ])

  res.json({
    rows: rows.map(r => ({
      userId: r.userId?.toString(),
      email: r.email,
      projectCount: r.projectCount || 0,
      docSizeBytes: r.docSizeBytes || 0,
      fileSizeBytes: r.fileSizeBytes || 0,
      totalSizeBytes: r.totalSizeBytes || 0,
      lastProjectCreatedAt: r.lastProjectCreatedAt || null,
      lastLoggedIn: r.lastLoggedIn || null,
      computedAt: r.computedAt || null,
    })),
    total,
    page,
    limit,
    sortBy,
    sortDir: sortDir === 1 ? 'asc' : 'desc',
  })
}

// Launch the recompute script as a detached background process. The web process
// already has the container environment (incl. STAGING_PASSWORD for history-v1),
// which the child inherits via process.env — so file sizing works here too.
function refresh(req, res) {
  if (refreshRunning) {
    return res.status(409).json({ status: 'already-running' })
  }
  refreshRunning = true

  const child = spawn('node', [SCRIPT_PATH, '--commit'], {
    cwd: WEB_ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.on('error', err => {
    logger.error({ err }, 'failed to spawn user-stats recompute')
    refreshRunning = false
  })
  child.on('exit', code => {
    logger.info({ code }, 'user-stats recompute finished')
    refreshRunning = false
  })
  child.unref()

  res.status(202).json({ status: 'started' })
}

export default {
  renderPage,
  getData: expressify(getData),
  refresh,
}
