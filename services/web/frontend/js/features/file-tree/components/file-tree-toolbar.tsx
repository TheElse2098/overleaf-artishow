import { useTranslation } from 'react-i18next'
import GitPullButton from './GitPullButton'
import MaterialIcon from '@/shared/components/material-icon'
import useCollapsibleFileTree from '@/features/file-tree/hooks/use-collapsible-file-tree'
import FileTreeActionButtons from './file-tree-action-buttons'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'

function FileTreeToolbar() {
  const { t } = useTranslation()
  const { fileTreeExpanded, toggleFileTreeExpanded } = useCollapsibleFileTree()
  const { projectId } = useProjectContext()
  const { id: userId } = useUserContext()

  return (
    <div className="file-tree-toolbar">
      <button
        className="file-tree-expand-collapse-button"
        onClick={toggleFileTreeExpanded}
        aria-label={
          fileTreeExpanded ? t('hide_file_tree') : t('show_file_tree')
        }
      >
        <MaterialIcon
          type={
            fileTreeExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'
          }
        />
        <h4>{t('file_tree')}</h4>
      </button>
      <FileTreeActionButtons fileTreeExpanded={fileTreeExpanded} />
      {fileTreeExpanded && <GitPullButton projectId={projectId} userId={userId} />}
    </div>
  )
}

export default FileTreeToolbar
