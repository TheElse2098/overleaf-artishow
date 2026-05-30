import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../../infrastructure/event-tracking'
import { useProjectContext } from '@/shared/context/project-context'

import {
  DropdownDivider,
  DropdownItem,
} from '@/features/ui/components/bootstrap-5/dropdown-menu'
import { useUserContext } from '../../../../shared/context/user-context'
import { useFileTreeData } from '../../../../shared/context/file-tree-data-context'
import { getFullPath } from '../../contexts/get-full-path'
import { useFileTreeActionable } from '../../contexts/file-tree-actionable'
import { useFileTreeSelectable } from '../../contexts/file-tree-selectable'
import { copyDirectory } from '../../../../shared/utils/storage-handler'

import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../../infrastructure/fetch-json'

type NewProjectData = {
  project_id: string
  owner_ref: string
  owner: {
    first_name: string
    last_name: string
    email: string
    id: string
  }
}


function FileTreeItemMenuItems() {
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()

  const { id: userId } = useUserContext()
  const { projectId } = useProjectContext()
  const { t } = useTranslation()

  const {
    canRename,
    canDelete,
    canCreate,
    parentFolderID,
    startRenaming,
    startDeleting,
    startCreatingFolder,
    startCreatingDocOrFile,
    startUploadingDocOrFile,
    downloadPath,
    selectedFileName
  } = useFileTreeActionable()

  const { fileTreeData } = useFileTreeData()
  const { selectedEntityIds } = useFileTreeSelectable()

  const { project } = useProjectContext()
  const projectOwner = project?.owner?._id

  const selectedFilePath = useMemo(() => {
    if (selectedEntityIds?.size === 1) {
      const [selectedEntityId] = selectedEntityIds
      return getFullPath(fileTreeData, selectedEntityId).slice(1)
    }
    return null;
  }, [fileTreeData, selectedEntityIds])

  const downloadWithAnalytics = useCallback(() => {
    // we are only interested in downloads of bib files WRT analytics, for the purposes of promoting the tpr integrations
    if (selectedFileName?.endsWith('.bib')) {
      eventTracking.sendMB('download-bib-file', { projectOwner })
    }
  }, [selectedFileName, projectOwner])

  const createWithAnalytics = useCallback(() => {
    eventTracking.sendMB('new-file-click', { location: 'file-menu' })
    startCreatingDocOrFile()
  }, [startCreatingDocOrFile])

  const uploadWithAnalytics = useCallback(() => {
    eventTracking.sendMB('upload-click', { location: 'file-menu' })
    startUploadingDocOrFile()
  }, [startUploadingDocOrFile])
  return(
    <>
      {canRename ? (
        <li role="none">
          <DropdownItem onClick={startRenaming}>{t('rename')}</DropdownItem>
        </li>
      ) : null}
      {downloadPath ? (
        <li role="none">
          <DropdownItem
            href={downloadPath}
            onClick={downloadWithAnalytics}
            download={selectedFileName ?? undefined}
          >
            {t('download')}
          </DropdownItem>
        </li>
      ) : null}
      {canDelete ? (
        <li role="none">
          <DropdownItem onClick={startDeleting}>{t('delete')}</DropdownItem>
        </li>
      ) : null}
      {canCreate ? (
        <>
          <DropdownDivider />
          <li role="none">
            <DropdownItem onClick={createWithAnalytics}>
              {t('new_file')}
            </DropdownItem>
          </li>
          <li role="none">
            <DropdownItem onClick={startCreatingFolder}>
              {t('new_folder')}
            </DropdownItem>
          </li>
          <li role="none">
            <DropdownItem onClick={uploadWithAnalytics}>
              {t('upload')}
            </DropdownItem>
          </li>
        </>
      ) : null}
      {canDelete ? (
        <DropdownItem onClick={() => {
            runAsync(
               postJSON('/git-add', {
                 body:{
                    projectId: projectId,
                    userId: userId,
                    filePath: selectedFilePath
                 }
              })
               .catch( error => {
                 alert(error.data.errorReason);
               })
            )
      }}>Add</DropdownItem>
      ) : null}
    </>
  )
}

export default FileTreeItemMenuItems
