import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { getJSON, postJSON } from '../../../../infrastructure/fetch-json'
import { FullSizeLoadingSpinner } from '@/shared/components/loading-spinner'
import Notification from '@/shared/components/notification'
import TemplatesList from './templates-list'

type Template = {
  id: string
  name: string
  description?: string
  previewUrl?: string
  category?: string
  tags?: string[]
}

type ImportFromTemplateModalProps = {
  onHide: () => void
  openProject: (projectId: string) => void
}

function ImportFromTemplateModal({
  onHide,
  openProject,
}: ImportFromTemplateModalProps) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingId, setCreatingId] = useState<string | null>(null)

  useEffect(() => {
    getJSON('/project/templates')
      .then((response: { templates: Template[] }) => {
        setTemplates(response.templates || [])
      })
      .catch(() => {
        setError(t('generic_something_went_wrong'))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [t])

  const handleTemplateSelect = async (templateId: string) => {
    setCreatingId(templateId)
    setError(null)
    try {
      const response = await postJSON(
        `/project/template/${templateId}/clone`
      )
      openProject(response.project_id)
    } catch {
      setError(t('generic_something_went_wrong'))
      setCreatingId(null)
    }
  }

  return (
    <OLModal
      show
      animation
      onHide={onHide}
      id="import-from-template-modal"
      backdrop="static"
      size="lg"
    >
      <OLModalHeader closeButton>
        <OLModalTitle as="h3">{t('import_from_template')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {loading && <FullSizeLoadingSpinner />}

        {error && (
          <div className="notification-list">
            <Notification type="error" content={error} />
          </div>
        )}

        {!loading && (
          <TemplatesList
            templates={templates}
            onTemplateSelect={handleTemplateSelect}
            creatingId={creatingId}
          />
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide} disabled={!!creatingId}>
          {t('cancel')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default ImportFromTemplateModal
