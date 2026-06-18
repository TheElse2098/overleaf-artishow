import minimist from 'minimist'
import pLimit from 'p-limit'
import {
  ObjectId,
  db,
  getCollectionInternal,
  waitForDb,
} from '../app/src/infrastructure/mongodb.mjs'
import ProjectEntityHandler from '../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../app/src/Features/Project/ProjectGetter.mjs'
import Errors from '../app/src/Features/Errors/Errors.js'
import HistoryManager from '../app/src/Features/History/HistoryManager.mjs'


// Pre-computes the admin "User Statistics" snapshot into the `userStats`
// collection (one document per user). The admin page reads ONLY this snapshot,
// so the heavy work lives here and never in the request path.
//
// Usage:
//   node scripts/recompute_user_stats.mjs                 # dry run, incremental
//   node scripts/recompute_user_stats.mjs --commit        # write, incremental
//   node scripts/recompute_user_stats.mjs --commit --full # write, recompute all
//   node scripts/recompute_user_stats.mjs --commit --concurrency=10 --limit=100
//
// Flags:
//   --commit            actually write to `userStats` (otherwise dry run)
//   --full              recompute every user (default: incremental — only users
//                       whose projects changed since their last computedAt)
//   --concurrency=N     max concurrent per-project size computations (default 5)
//   --limit=N           cap the number of users processed (for sampling/testing)
//
// Storage size reuses the logic of scripts/count_project_size.mjs:
//   - docs  (text)    : summed via a Mongo aggregation over db.docs
//   - files (binary)  : one HistoryManager blob lookup per file (the bottleneck)

const argv = minimist(process.argv.slice(2), {
  boolean: ['commit', 'full'],
  default: { concurrency: 5 },
})
const COMMIT = argv.commit
const FULL = argv.full
const CONCURRENCY = parseInt(argv.concurrency, 10) || 5
const LIMIT = argv.limit ? parseInt(argv.limit, 10) : 0

const limit = pLimit(CONCURRENCY)

let processed = 0
let skipped = 0
let errored = 0

async function getUserStatsCollection() {
  return await getCollectionInternal('userStats')
}

// One pass over `projects`, grouped by owner: cheap aggregates (count, latest
// created/updated). `lastProjectId` is the max ObjectId, whose generation time
// is the most recent creation date (no dedicated "created" field exists).
async function aggregateProjectsByOwner() {
  return await db.projects
    .aggregate(
      [
        { $match: { owner_ref: { $exists: true } } },
        {
          $group: {
            _id: '$owner_ref',
            projectCount: { $sum: 1 },
            lastProjectUpdatedAt: { $max: '$lastUpdated' },
            lastProjectId: { $max: '$_id' },
            projectIds: { $push: '$_id' },
          },
        },
      ],
      { allowDiskUse: true }
    )
    .toArray()
}

async function countFilesSize(files, projectId) {
  if (!(files?.length > 0)) {
    return 0
  }
  let totalFileSize = 0
  for (const { file } of files) {
    const { contentLength } =
      await HistoryManager.promises.requestBlobWithProjectId(
        projectId,
        file.hash,
        'HEAD'
      )
    totalFileSize += contentLength
  }
  return totalFileSize
}

async function countDocsSizes(docs) {
  if (!(docs?.length > 0)) {
    return 0
  }
  let totalDocSize = 0
  for (const { doc } of docs) {
    const result = await db.docs.aggregate([
      { $match: { _id: new ObjectId(doc._id) } },
      {
        $project: {
          lineSizeInBytes: {
            $reduce: {
              input: { $ifNull: ['$lines', []] },
              initialValue: 0,
              in: { $add: ['$$value', { $strLenBytes: '$$this' }] },
            },
          },
        },
      },
    ])
    const next = await result.next()
    const lineSizeInBytes = next?.lineSizeInBytes
    if (isNaN(lineSizeInBytes)) {
      throw new Error(`unable to fetch lineSizeInBytes for docId=${doc._id}`)
    }
    totalDocSize += lineSizeInBytes
  }
  return totalDocSize
}

// docs + files size for a single project. Errors (missing project / blob) are
// swallowed so one bad project never aborts the whole run.
async function computeProjectSize(projectId) {
  try {
    const project = await ProjectGetter.promises.getProject(projectId)
    if (!project) {
      throw new Errors.NotFoundError('project not found')
    }
    const { files, docs } =
      ProjectEntityHandler.getAllEntitiesFromProject(project)
    const [fileSizeBytes, docSizeBytes] = await Promise.all([
      countFilesSize(files, projectId),
      countDocsSizes(docs),
    ])
    return { docSizeBytes, fileSizeBytes }
  } catch (err) {
    errored++
    console.error('error sizing project', projectId.toString(), err.message)
    return { docSizeBytes: 0, fileSizeBytes: 0 }
  }
}

async function computeUserStats(group) {
  const projectIds = group.projectIds
  const sizes = await Promise.all(
    projectIds.map(id => limit(() => computeProjectSize(id)))
  )
  const docSizeBytes = sizes.reduce((s, x) => s + x.docSizeBytes, 0)
  const fileSizeBytes = sizes.reduce((s, x) => s + x.fileSizeBytes, 0)
  return {
    projectCount: group.projectCount,
    docSizeBytes,
    fileSizeBytes,
    totalSizeBytes: docSizeBytes + fileSizeBytes,
    lastProjectCreatedAt: group.lastProjectId.getTimestamp(),
    lastProjectUpdatedAt: group.lastProjectUpdatedAt || null,
  }
}

async function main() {
  await waitForDb()
  const userStats = await getUserStatsCollection()
  if (COMMIT) {
    await userStats.createIndex({ userId: 1 }, { unique: true })
  }

  console.error(
    `mode=${FULL ? 'full' : 'incremental'} commit=${COMMIT} concurrency=${CONCURRENCY}`
  )

  let groups = await aggregateProjectsByOwner()
  console.error(`found ${groups.length} users owning projects`)

  // Incremental: skip users whose projects haven't changed since their snapshot.
  // (Caveat: a pure deletion may not bump any remaining project's lastUpdated,
  // so a periodic --full run is still needed to catch shrinking counts.)
  if (!FULL) {
    const existing = await userStats
      .find({}, { projection: { userId: 1, computedAt: 1 } })
      .toArray()
    const computedAtByUser = new Map(
      existing.map(s => [s.userId.toString(), s.computedAt])
    )
    groups = groups.filter(g => {
      const prev = computedAtByUser.get(g._id.toString())
      if (!prev) return true // never computed
      if (!g.lastProjectUpdatedAt) return false
      return g.lastProjectUpdatedAt > prev
    })
    console.error(`incremental: ${groups.length} users need recomputing`)
  }

  if (LIMIT && groups.length > LIMIT) {
    groups = groups.slice(0, LIMIT)
    console.error(`limited to ${LIMIT} users`)
  }

  // Fetch email + lastLoggedIn for the target users in one query.
  const userIds = groups.map(g => g._id)
  const users = await db.users
    .find(
      { _id: { $in: userIds } },
      { projection: { email: 1, lastLoggedIn: 1 } }
    )
    .toArray()
  const userById = new Map(users.map(u => [u._id.toString(), u]))

  for (const group of groups) {
    const stats = await computeUserStats(group)
    const user = userById.get(group._id.toString())
    const doc = {
      userId: group._id,
      email: user?.email || null,
      lastLoggedIn: user?.lastLoggedIn || null,
      ...stats,
      computedAt: new Date(),
    }
    if (COMMIT) {
      await userStats.updateOne(
        { userId: group._id },
        { $set: doc },
        { upsert: true }
      )
    } else {
      console.error(
        'DRY',
        doc.email,
        `projects=${doc.projectCount}`,
        `total=${doc.totalSizeBytes}B`,
        `(docs=${doc.docSizeBytes} files=${doc.fileSizeBytes})`
      )
    }
    processed++
  }

  console.error(
    `done: processed=${processed} skipped=${skipped} sizingErrors=${errored}`
  )
}

try {
  await main()
  process.exit(0)
} catch (err) {
  console.error('fatal', err)
  process.exit(1)
}
