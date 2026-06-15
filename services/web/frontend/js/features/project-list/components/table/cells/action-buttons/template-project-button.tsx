import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON } from '../../../../../../infrastructure/fetch-json'
import { useProjectListContext } from '../../../../context/project-list-context'
import { Project } from '../../../../../../../../types/project/dashboard/api'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import getMeta from '../../../../../../utils/meta'

type TemplateProjectButtonProps = {
  project: Project
  children: (text: string, handleOpenModal: () => void) => React.ReactElement
}

function TemplateProjectButton({
  project,
  children,
}: TemplateProjectButtonProps) {
  const { t } = useTranslation()
  const { updateProjectViewData } = useProjectListContext()
  const isAdmin = getMeta('ol-user')?.isAdmin
  const [showModal, setShowModal] = useState(false)
  const [description, setDescription] = useState(project.templateDescription)
  const [isGeneral, setIsGeneral] = useState(
    project.templateCategory === 'General'
  )
  const [saving, setSaving] = useState(false)

  const text = project.isTemplate
    ? isAdmin
      ? 'Edit description or category'
      : 'Edit description'
    : 'Mark as template'

  const handleOpenModal = useCallback(() => {
    setDescription(project.templateDescription)
    setIsGeneral(project.templateCategory === 'General')
    setShowModal(true)
  }, [project.templateDescription, project.templateCategory])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // Saving the modal marks the project as a template; admins may flag it
      // "General", everyone else (and admins who leave it unchecked) gets a
      // "Personnel" template.
      await postJSON(`/project/${project.id}/template`, {
        body: { isTemplate: true, templateDescription: description, isGeneral },
      })
      const templateCategory = isAdmin && isGeneral ? 'General' : 'Personnel'
      updateProjectViewData({
        ...project,
        isTemplate: true,
        templateDescription: description,
        templateCategory,
      })
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }, [project, description, isGeneral, isAdmin, updateProjectViewData])

  // Only the owner can (un)mark a project as a template.
  if (project.accessLevel !== 'owner' || project.archived || project.trashed) {
    return null
  }

  return (
    <>
      {children(text, handleOpenModal)}
      <OLModal
        show={showModal}
        onHide={() => setShowModal(false)}
        id={`template-project-modal-${project.id}`}
      >
        <OLModalHeader closeButton>
          <OLModalTitle>Template</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          {isAdmin && (
            <div className="mb-2">
              <label>
                <input
                  type="checkbox"
                  checked={isGeneral}
                  onChange={e => setIsGeneral(e.target.checked)}
                  className="me-2"
                />
                Mark as general template
              </label>
            </div>
          )}
          <OLFormControl
            type="text"
            placeholder="Template description"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDescription(e.target.value)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' && !saving) {
                handleSave()
              }
            }}
          />
          <div className="mt-2 text-muted small">
            Category: {isAdmin && isGeneral ? 'General' : 'Personnel'}
          </div>
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={() => setShowModal(false)}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            isLoading={saving}
          >
            {t('save')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}

export default memo(TemplateProjectButton)

const TemplateProjectButtonTooltip = memo(function TemplateProjectButtonTooltip({
  project,
}: { project: Project }) {
  const isAdmin = getMeta('ol-user')?.isAdmin
  const text = project.isTemplate
    ? isAdmin
      ? 'Edit description or category'
      : 'Edit description'
    : 'Mark as template'

  return (
    <TemplateProjectButton project={project}>
      {(_, handleOpenModal) => (
        <OLTooltip
          key={`tooltip-template-project-${project.id}`}
          id={`template-project-${project.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <span>
            <OLIconButton
              onClick={handleOpenModal}
              variant="link"
              accessibilityLabel={text}
              className="action-btn"
              icon="bookmark"
            />
          </span>
        </OLTooltip>
      )}
    </TemplateProjectButton>
  )
})

export { TemplateProjectButtonTooltip }
