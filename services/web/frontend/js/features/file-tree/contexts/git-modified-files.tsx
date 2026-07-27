import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  FC,
} from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '@/shared/context/user-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { getJSON } from '@/infrastructure/fetch-json'
import { findEntityByPath } from '../util/path'

/*
 * Tracks which files are modified according to Git (the same list the Git menu
 * shows as "not staged"), exposed as a Set of entity IDs so the file tree can
 * cheaply flag each row. The backend returns relative paths, which we resolve
 * to entity IDs against the current tree.
 *
 * Everything is gated on the project actually having a linked Git remote
 * (queried once via /git-info): on non-Git projects we never query or show
 * markers.
 */
type GitModifiedFilesContextValue = {
  modifiedFileIds: Set<string>
  refreshModifiedFiles: () => void
}

const GitModifiedFilesContext = createContext<
  GitModifiedFilesContextValue | undefined
>(undefined)

export const GitModifiedFilesProvider: FC = ({ children }) => {
  const { projectId } = useProjectContext()
  const { id: userId } = useUserContext()
  const { fileTreeData } = useFileTreeData()
  const { compiling } = useDetachCompileContext()
  const [modifiedPaths, setModifiedPaths] = useState<string[]>([])
  // null = not yet known, true/false once /git-info answered.
  const [isGitLinked, setIsGitLinked] = useState<boolean | null>(null)

  // Determine once whether the project is linked to a Git remote.
  useEffect(() => {
    if (!projectId || !userId) return
    let cancelled = false
    getJSON(`/git-info?projectId=${projectId}`)
      .then((info: { remoteUrl?: string | null }) => {
        if (!cancelled) setIsGitLinked(Boolean(info?.remoteUrl))
      })
      .catch(() => {
        if (!cancelled) setIsGitLinked(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, userId])

  const refreshModifiedFiles = useCallback(() => {
    // Never query the git service for non-Git projects.
    if (!projectId || !userId || !isGitLinked) {
      setModifiedPaths([])
      return
    }
    getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`)
      .then((res: { notStaged?: string[]; deleted?: string[] }) => {
        setModifiedPaths([...(res?.notStaged || []), ...(res?.deleted || [])])
      })
      .catch(() => {
        // Git service unavailable: just show no markers.
        setModifiedPaths([])
      })
  }, [projectId, userId, isGitLinked])

  // Load once we know the project is Git-linked.
  useEffect(() => {
    if (isGitLinked) refreshModifiedFiles()
  }, [isGitLinked, refreshModifiedFiles])

  // The Git menu (commit/push) lives in a separate React tree, so it signals
  // changes via a window event rather than through this context.
  useEffect(() => {
    if (!isGitLinked) return
    window.addEventListener('git:files-changed', refreshModifiedFiles)
    return () =>
      window.removeEventListener('git:files-changed', refreshModifiedFiles)
  }, [isGitLinked, refreshModifiedFiles])

  // Refresh on every finished compilation (compiling goes true -> false): the
  // user has likely just edited files, so the Git status may have changed.
  const wasCompiling = useRef(false)
  useEffect(() => {
    if (wasCompiling.current && !compiling && isGitLinked) {
      refreshModifiedFiles()
    }
    wasCompiling.current = compiling
  }, [compiling, isGitLinked, refreshModifiedFiles])

  // Resolve paths -> entity IDs against the current tree. Recomputed when either
  // the modified list or the tree changes (e.g. a file is added/renamed).
  const modifiedFileIds = useMemo(() => {
    const ids = new Set<string>()
    if (!isGitLinked || !fileTreeData) return ids
    for (const path of modifiedPaths) {
      const found = findEntityByPath(fileTreeData, path)
      if (found && found.type !== 'folder') {
        ids.add(found.entity._id)
      }
    }
    return ids
  }, [isGitLinked, modifiedPaths, fileTreeData])

  const value = useMemo(
    () => ({ modifiedFileIds, refreshModifiedFiles }),
    [modifiedFileIds, refreshModifiedFiles]
  )

  return (
    <GitModifiedFilesContext.Provider value={value}>
      {children}
    </GitModifiedFilesContext.Provider>
  )
}

export function useGitModifiedFiles(): GitModifiedFilesContextValue {
  const context = useContext(GitModifiedFilesContext)
  if (!context) {
    // Used outside the provider (e.g. legacy editor file tree): no markers.
    return { modifiedFileIds: new Set(), refreshModifiedFiles: () => {} }
  }
  return context
}
