import { Project } from '../../../../../../../types/project/dashboard/api'
import { CopyProjectButtonTooltip } from './action-buttons/copy-project-button'
import { ArchiveProjectButtonTooltip } from './action-buttons/archive-project-button'
import { TrashProjectButtonTooltip } from './action-buttons/trash-project-button'
import { UnarchiveProjectButtonTooltip } from './action-buttons/unarchive-project-button'
import { UntrashProjectButtonTooltip } from './action-buttons/untrash-project-button'
import { DownloadProjectButtonTooltip } from './action-buttons/download-project-button'
import { LeaveProjectButtonTooltip } from './action-buttons/leave-project-button'
import { DeleteProjectButtonTooltip } from './action-buttons/delete-project-button'
import { CompileAndDownloadProjectPDFButtonTooltip } from './action-buttons/compile-and-download-project-pdf-button'
import { TemplateProjectButtonTooltip } from './action-buttons/template-project-button'

type ActionsCellProps = {
  project: Project
}

export default function ActionsCell({ project }: ActionsCellProps) {
  return (
    <>
      <span className="hover-only-action-btn">
        <CopyProjectButtonTooltip project={project} />
      </span>
      <TemplateProjectButtonTooltip project={project} />
      <DownloadProjectButtonTooltip project={project} />
      <CompileAndDownloadProjectPDFButtonTooltip project={project} />
      <ArchiveProjectButtonTooltip project={project} />
      <UnarchiveProjectButtonTooltip project={project} />
      <UntrashProjectButtonTooltip project={project} />
      <LeaveProjectButtonTooltip project={project} />
      <DeleteProjectButtonTooltip project={project} />
      <TrashProjectButtonTooltip project={project} />
    </>
  )
}
