// template-card.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/features/ui/components/ol/ol-button'
import { postJSON } from '../../../../infrastructure/fetch-json'
import { useLocation } from '../../../../shared/hooks/use-location'

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
}

function TemplateCard({ template }: TemplateCardProps) {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const location = useLocation()

  const handleCreateProject = async () => {
    try {
      setIsCreating(true)
      
      const response = await postJSON('/project/new', {
        body: {
          projectName: `${template.name} Project`,
          template: 'from_template',
          templateId: template.id,
        },
      })

      if (response.project_id) {
        location.assign(`/project/${response.project_id}`)
      }
    } catch (error) {
      console.error('Error creating project from template:', error)
      setIsCreating(false)
    }
  }

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
            onClick={handleCreateProject}
            disabled={isCreating}
            className="w-100"
          >
            {isCreating ? t('creating') + '...' : 'Use template'}
          </OLButton>
        </div>
      </div>
    </div>
  )
}

export default TemplateCard