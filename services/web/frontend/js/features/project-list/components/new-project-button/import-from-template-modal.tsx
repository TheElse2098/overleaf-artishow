// import-from-template-modal.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLModal, {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/features/ui/components/ol/ol-modal'
import OLButton from '@/features/ui/components/ol/ol-button'
import { getJSON } from '../../../../infrastructure/fetch-json'
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
}

function ImportFromTemplateModal({ onHide }: ImportFromTemplateModalProps) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoading(true)
        const response = await getJSON('/project/templates')
        setTemplates(response.templates || [])
      } catch (err) {
        setError(t('no_templates_found'))
        console.error('Error fetching templates:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchTemplates()
  }, [t])

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

        {!loading && !error && <TemplatesList templates={templates} />}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>
          {t('cancel')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default ImportFromTemplateModal
