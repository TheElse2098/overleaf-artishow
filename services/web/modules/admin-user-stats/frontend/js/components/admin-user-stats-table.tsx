import { useCallback, useEffect, useState } from 'react'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

type Row = {
  userId: string
  email: string | null
  projectCount: number
  docSizeBytes: number
  fileSizeBytes: number
  totalSizeBytes: number
  lastProjectCreatedAt: string | null
  lastLoggedIn: string | null
  computedAt: string | null
}

type DataResponse = {
  rows: Row[]
  total: number
  page: number
  limit: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  refreshing: boolean
}

const COLUMNS: { key: string; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'projectCount', label: 'Projects' },
  { key: 'totalSizeBytes', label: 'Total size' },
  { key: 'docSizeBytes', label: 'Docs' },
  { key: 'fileSizeBytes', label: 'Files' },
  { key: 'lastProjectCreatedAt', label: 'Last project' },
  { key: 'lastLoggedIn', label: 'Last login' },
]

const LIMIT = 50
const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 150 // ~10 min safety cap

function formatBytes(n: number) {
  if (!n) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString() : '—'
}

export default function AdminUserStatsTable() {
  const [data, setData] = useState<DataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState('totalSizeBytes')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [recomputing, setRecomputing] = useState(false)

  const load = useCallback(async (): Promise<DataResponse | null> => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        sortBy,
        sortDir,
        search,
      })
      const res = await getJSON(`/admin/user-stats/data?${params.toString()}`)
      setData(res)
      return res
    } catch {
      setError('Failed to load user statistics')
      return null
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir, search])

  useEffect(() => {
    load()
  }, [load])

  // While a recompute is running, poll and reload until the server reports it
  // finished (refreshing=false), so the table shows fresh numbers on its own.
  useEffect(() => {
    if (!recomputing) {
      return
    }
    let attempts = 0
    const id = window.setInterval(async () => {
      attempts++
      const res = await load()
      if (!res || !res.refreshing || attempts >= MAX_POLLS) {
        setRecomputing(false)
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [recomputing, load])

  const onSort = (key: string) => {
    if (sortBy === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  const onRefresh = async () => {
    if (recomputing) {
      return
    }
    setRecomputing(true)
    try {
      await postJSON('/admin/user-stats/refresh')
    } catch {
      // 409 (already running) or 429 (rate limited): keep polling anyway, a job
      // may well be in progress.
    }
    // Reload immediately; if the job already finished, stop, otherwise the
    // polling effect takes over.
    const res = await load()
    if (res && !res.refreshing) {
      setRecomputing(false)
    }
  }

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0
  const computedAt = data?.rows[0]?.computedAt ?? null

  return (
    <div className="admin-user-stats">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">User Statistics</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRefresh}
          disabled={recomputing}
        >
          {recomputing ? 'Recomputing…' : 'Refresh now'}
        </button>
      </div>

      <input
        type="text"
        className="form-control mb-3"
        placeholder="Search by email"
        value={search}
        onChange={e => {
          setSearch(e.target.value)
          setPage(0)
        }}
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <table className="table table-striped">
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                style={{ cursor: 'pointer' }}
              >
                {col.label}
                {sortBy === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !data ? (
            <tr>
              <td colSpan={COLUMNS.length}>Loading…</td>
            </tr>
          ) : data && data.rows.length > 0 ? (
            data.rows.map(row => (
              <tr key={row.userId}>
                <td>{row.email || '—'}</td>
                <td>{row.projectCount}</td>
                <td>{formatBytes(row.totalSizeBytes)}</td>
                <td>{formatBytes(row.docSizeBytes)}</td>
                <td>{formatBytes(row.fileSizeBytes)}</td>
                <td>{formatDate(row.lastProjectCreatedAt)}</td>
                <td>{formatDate(row.lastLoggedIn)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={COLUMNS.length}>
                No data yet. Run the recompute script or click “Refresh now”.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="d-flex justify-content-between align-items-center">
        <span className="text-muted small">
          {data ? `${data.total} users` : ''}
          {computedAt ? ` · last computed ${formatDate(computedAt)}` : ''}
          {recomputing ? ' · recomputing…' : ''}
        </span>
        <div className="btn-group">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 0}
            onClick={() => setPage(p => p - 1)}
          >
            Prev
          </button>
          <span className="btn btn-light disabled">
            {page + 1} / {Math.max(totalPages, 1)}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
