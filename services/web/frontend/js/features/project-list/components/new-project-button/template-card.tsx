// template-card.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/features/ui/components/ol/ol-button'
import { postJSON, deleteJSON } from '../../../../infrastructure/fetch-json'
import { useLocation } from '../../../../shared/hooks/use-location'
import getMeta from '../../../../utils/meta'

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
  onRemoved: (id: string) => void
}

function TemplateCard({ template, onRemoved }: TemplateCardProps) {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const location = useLocation()
  const isAdmin = getMeta('ol-user')?.isAdmin
  // The catalogue only shows a user their own Personnel templates, so any
  // visible Personnel card belongs to the viewer and can be removed by them.
  const canRemove = isAdmin || template.category === 'Personnel'

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

  const handleRemove = async () => {
    try {
      setIsRemoving(true)
      await deleteJSON(`/project/${template.id}/template`)
      onRemoved(template.id)
    } catch (error) {
      console.error('Error removing template:', error)
      setIsRemoving(false)
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
        
        <div className="mt-auto d-flex gap-2">
          <OLButton
            variant="primary"
            size="sm"
            onClick={handleCreateProject}
            disabled={isCreating || isRemoving}
            className="flex-grow-1"
          >
            {isCreating ? t('creating') + '...' : 'Use template'}
          </OLButton>
          {canRemove && (
            <OLButton
              variant="danger"
              size="sm"
              onClick={handleRemove}
              disabled={isCreating || isRemoving}
            >
              {isRemoving ? '...' : 'Remove'}
            </OLButton>
          )}
        </div>
      </div>
    </div>
  )
}

export default TemplateCard