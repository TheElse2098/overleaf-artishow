import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'

type Template = {
  id: string
  name: string
  description?: string
  previewUrl?: string
  category?: string
  tags?: string[]
}

type TemplateCardProps = {
  template: Template
  onSelect: () => void
  isCreating?: boolean
  disabled?: boolean
}

function TemplateCard({ template, onSelect, isCreating, disabled }: TemplateCardProps) {
  const { t } = useTranslation()

  return (
    <div className="template-card card h-100">
      {template.previewUrl && (
        <div className="template-preview">
          <img
            src={template.previewUrl}
            alt={template.name}
            className="card-img-top"
            style={{ height: '150px', objectFit: 'cover' }}
          />
        </div>
      )}

      <div className="card-body d-flex flex-column">
        <h5 className="card-title">{template.name}</h5>

        {template.description && (
          <p className="card-text text-muted small flex-grow-1">
            {template.description}
          </p>
        )}

        {template.category && (
          <div className="mb-2">
            <span className="badge badge-secondary">{template.category}</span>
          </div>
        )}

        {template.tags && template.tags.length > 0 && (
          <div className="template-tags mb-2">
            {template.tags.map(tag => (
              <span key={tag} className="badge badge-light mr-1">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto">
          <OLButton
            variant="primary"
            size="sm"
            onClick={onSelect}
            disabled={isCreating || disabled}
            className="w-100"
          >
            {isCreating ? `${t('creating')}...` : t('use_template')}
          </OLButton>
        </div>
      </div>
    </div>
  )
}

export default TemplateCard
