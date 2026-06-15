import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON } from '../../../../../../infrastructure/fetch-json'
import { useProjectListContext } from '../../../../context/project-list-context'
import { Project } from '../../../../../../../../types/project/dashboard/api'
import OLModal, {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/features/ui/components/ol/ol-modal'
import OLButton from '@/features/ui/components/ol/ol-button'
import OLFormControl from '@/features/ui/components/ol/ol-form-control'
import OLTooltip from '@/features/ui/components/ol/ol-tooltip'
import OLIconButton from '@/features/ui/components/ol/ol-icon-button'
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
  const [isTemplate, setIsTemplate] = useState(project.isTemplate)
  const [description, setDescription] = useState(project.templateDescription)
  const [isGeneral, setIsGeneral] = useState(
    project.templateCategory === 'General'
  )
  const [saving, setSaving] = useState(false)

  const text = project.isTemplate
    ? 'Modifier le template'
    : 'Marquer comme template'

  const handleOpenModal = useCallback(() => {
    setIsTemplate(project.isTemplate)
    setDescription(project.templateDescription)
    setIsGeneral(project.templateCategory === 'General')
    setShowModal(true)
  }, [
    project.isTemplate,
    project.templateDescription,
    project.templateCategory,
  ])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await postJSON(`/project/${project.id}/template`, {
        body: { isTemplate, templateDescription: description, isGeneral },
      })
      const templateCategory = isTemplate
        ? isAdmin && isGeneral
          ? 'General'
          : 'Personnel'
        : ''
      updateProjectViewData({
        ...project,
        isTemplate,
        templateDescription: description,
        templateCategory,
      })
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }, [project, isTemplate, description, isGeneral, isAdmin, updateProjectViewData])

  if (project.archived || project.trashed) return null

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
          <div className="mb-2">
            <label>
              <input
                type="checkbox"
                checked={isTemplate}
                onChange={e => setIsTemplate(e.target.checked)}
                className="me-2"
              />
              Marquer ce projet comme template
            </label>
          </div>
          {isTemplate && (
            <>
              <OLFormControl
                type="text"
                placeholder="Description du template"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDescription(e.target.value)
                }
              />
              {isAdmin && (
                <div className="mt-2">
                  <label>
                    <input
                      type="checkbox"
                      checked={isGeneral}
                      onChange={e => setIsGeneral(e.target.checked)}
                      className="me-2"
                    />
                    Marquer comme template général
                  </label>
                </div>
              )}
              <div className="mt-2 text-muted small">
                Catégorie : {isAdmin && isGeneral ? 'General' : 'Personnel'}
              </div>
            </>
          )}
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
  const text = project.isTemplate ? 'Modifier le template' : 'Marquer comme template'

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
