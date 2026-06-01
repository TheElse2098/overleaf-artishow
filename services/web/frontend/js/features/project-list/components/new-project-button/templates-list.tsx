import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import TemplateCard from './template-card'

type Template = {
  id: string
  name: string
  description?: string
  previewUrl?: string
  category?: string
  tags?: string[]
}

type TemplatesListProps = {
  templates: Template[]
  onTemplateSelect: (templateId: string) => void
  creatingId?: string | null
}

function TemplatesList({
  templates,
  onTemplateSelect,
  creatingId,
}: TemplatesListProps) {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  const categories = [
    'all',
    ...new Set(templates.map(t => t.category).filter(Boolean)),
  ]

  const filteredTemplates = templates.filter(template => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory =
      selectedCategory === 'all' || template.category === selectedCategory

    return matchesSearch && matchesCategory
  })

  return (
    <div className="templates-list">
      <div className="templates-filters mb-4">
        <div className="row">
          <div className="col-md-8">
            <OLFormControl
              type="text"
              placeholder={t('search_templates')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="form-control"
              disabled={!!creatingId}
            />
          </div>
          <div className="col-md-4">
            <select
              className="form-control"
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              disabled={!!creatingId}
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category === 'all' ? t('all_categories') : category}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="templates-grid">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-muted">{t('no_templates_found')}</p>
          </div>
        ) : (
          <div className="row">
            {filteredTemplates.map(template => (
              <div key={template.id} className="col-lg-4 col-md-6 mb-3">
                <TemplateCard
                  template={template}
                  onSelect={() => onTemplateSelect(template.id)}
                  isCreating={creatingId === template.id}
                  disabled={!!creatingId && creatingId !== template.id}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default TemplatesList
