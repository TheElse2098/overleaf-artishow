import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  FC,
} from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '@/shared/context/user-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { getJSON } from '@/infrastructure/fetch-json'
import { findEntityByPath } from '../util/path'

/*
 * Tracks which files are modified according to Git (the same list the Git menu
 * shows as "not staged"), exposed as a Set of entity IDs so the file tree can
 * cheaply flag each row. The backend returns relative paths, which we resolve
 * to entity IDs against the current tree.
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
  const [modifiedPaths, setModifiedPaths] = useState<string[]>([])

  const refreshModifiedFiles = useCallback(() => {
    if (!projectId || !userId) return
    getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`)
      .then((res: { notStaged?: string[]; deleted?: string[] }) => {
        setModifiedPaths([...(res?.notStaged || []), ...(res?.deleted || [])])
      })
      .catch(() => {
        // Not a git project, or git service unavailable: just show no markers.
        setModifiedPaths([])
      })
  }, [projectId, userId])

  // Load once when the tree is ready.
  useEffect(() => {
    refreshModifiedFiles()
  }, [refreshModifiedFiles])

  // The Git menu (commit/push) lives in a separate React tree, so it signals
  // changes via a window event rather than through this context.
  useEffect(() => {
    window.addEventListener('git:files-changed', refreshModifiedFiles)
    return () =>
      window.removeEventListener('git:files-changed', refreshModifiedFiles)
  }, [refreshModifiedFiles])

  // Resolve paths -> entity IDs against the current tree. Recomputed when either
  // the modified list or the tree changes (e.g. a file is added/renamed).
  const modifiedFileIds = useMemo(() => {
    const ids = new Set<string>()
    if (!fileTreeData) return ids
    for (const path of modifiedPaths) {
      const found = findEntityByPath(fileTreeData, path)
      if (found && found.type !== 'folder') {
        ids.add(found.entity._id)
      }
    }
    return ids
  }, [modifiedPaths, fileTreeData])

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
