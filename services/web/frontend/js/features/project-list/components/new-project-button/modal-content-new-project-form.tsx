import React, { useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  getJSON,
  postJSON,
} from '../../../../infrastructure/fetch-json'
import { useRefWithAutoFocus } from '../../../../shared/hooks/use-ref-with-auto-focus'
import { useLocation } from '../../../../shared/hooks/use-location'
import Notification from '@/shared/components/notification'
import {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import { CloneProjectTag } from '@/features/clone-project-modal/components/clone-project-tag'
import { addProjectsToTag } from '@/features/project-list/util/api'
import { captureException } from '@/infrastructure/error-reporter'
import { Tag } from '../../../../../../app/src/Features/Tags/types'
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

type LocalTemplate = {
  id: string
  name: string
  description?: string
}

type Props = {
  onCancel: () => void
  template?: string
  initialTags?: Tag[]
}

function ModalContentNewProjectForm({
  onCancel,
  template = 'none',
  initialTags = [],
}: Props) {
  const { t } = useTranslation()
  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()
  const [projectName, setProjectName] = useState('')
  const [projectTags, setProjectTags] = useState<Tag[]>(initialTags)
  const [redirecting, setRedirecting] = useState(false)
  const [localTemplates, setLocalTemplates] = useState<LocalTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()
  const location = useLocation()

  const removeTag = useCallback((tag: Tag) => {
    setProjectTags(value => value.filter(item => item._id !== tag._id))
  }, [])

  useEffect(() => {
    if (template !== 'example') return
    getJSON('/project/templates')
      .then((data: { templates: LocalTemplate[] }) => {
        const templates = data.templates ?? []
        setLocalTemplates(templates)
        if (templates.length > 0) setSelectedTemplateId(templates[0].id)
      })
      .catch(() => {})
  }, [template])

  const createNewProject = () => {
    const body: Record<string, string> = { projectName, template }
    if (template === 'example' && selectedTemplateId) {
      body.templateId = selectedTemplateId
    }
    runAsync(
      postJSON('/project/new', { body })
    )
      .then(async data => {
        if (data.project_id) {
          // prevents clicking on create again between async load of next page and pending state being finished
          setRedirecting(true)
          for (const tag of projectTags) {
            try {
              await addProjectsToTag(tag._id, [data.project_id])
            } catch (err) {
              captureException(err as Error)
            }
          }
          location.assign(`/project/${data.project_id}`)
        }
      })
      .catch(() => {})
  }

  const handleChangeName = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(e.currentTarget.value)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createNewProject()
  }

  return (
    <>
      <OLModalHeader>
        <OLModalTitle>{t('new_project')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {isError && (
          <div className="notification-list">
            <Notification
              type="error"
              content={getUserFacingMessage(error) as string}
            />
          </div>
        )}
        <OLForm onSubmit={handleSubmit}>
        <OLFormGroup controlId="project-name">
            <OLFormLabel>{t('project_name')}</OLFormLabel>
            <OLFormControl
              type="text"
              ref={autoFocusedRef}
              onChange={handleChangeName}
              value={projectName}
            />
          </OLFormGroup>

          {template === 'example' && localTemplates.length > 0 && (
            <OLFormSelect
              className="mt-2"
              value={selectedTemplateId}
              onChange={e => setSelectedTemplateId(e.target.value)}
            >
              {localTemplates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name}
                </option>
              ))}
            </OLFormSelect>
          )}

          {projectTags.length > 0 && (
            <OLFormGroup controlId="new-project-tags-list">
              <OLFormLabel>{t('tags')}: </OLFormLabel>
              <div role="listbox" id="new-project-tags-list">
                {projectTags.map(tag => (
                  <CloneProjectTag
                    key={tag._id}
                    tag={tag}
                    removeTag={removeTag}
                  />
                ))}
              </div>
            </OLFormGroup>          )}
        </OLForm>
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant="primary"
          onClick={createNewProject}
          disabled={projectName === '' || isLoading || redirecting}
          isLoading={isLoading}
          loadingLabel={t('creating')}
        >
          {t('create')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default ModalContentNewProjectForm
