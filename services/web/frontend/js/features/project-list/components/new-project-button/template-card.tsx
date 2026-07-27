// template-card.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import { postJSON, deleteJSON } from '../../../../infrastructure/fetch-json'
import { useLocation } from '../../../../shared/hooks/use-location'
import getMeta from '../../../../utils/meta'
import TemplateShareModal from './template-share-modal'

type Template = {
  id: string
  name: string
  description?: string
  previewUrl?: string
  category?: string
  tags?: string[]
  // Sharing metadata from getVisibleTemplates.
  isOwnedByViewer?: boolean
  sharedWithCount?: number
  sharedByName?: string
}

type TemplateCardProps = {
  template: Template
  onRemoved: (id: string) => void
}

function TemplateCard({ template, onRemoved }: TemplateCardProps) {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [showNameModal, setShowNameModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharedCount, setSharedCount] = useState(template.sharedWithCount ?? 0)
  const [projectName, setProjectName] = useState('')
  const location = useLocation()
  const isAdmin = getMeta('ol-user')?.isAdmin
  const currentUserId = getMeta('ol-user_id')
  // Owner-only actions. The viewer owns the template when the backend says so;
  // fall back to the old "Personnel" heuristic for safety if the field is absent.
  const isOwner =
    template.isOwnedByViewer ?? template.category === 'Personnel'
  // A recipient is someone who sees a Personnel template they don't own — it was
  // shared with them.
  const isRecipient = !isOwner && template.category === 'Personnel'
  // The owner (or an admin) can delete the template outright. A recipient can
  // "remove" it too, but that only drops their own access (a self-unshare).
  const canRemove = isOwner || isAdmin || isRecipient
  // Only the owner can share, and only a non-General (Personnel) template.
  const canShare = isOwner && template.category !== 'General'
  // Keep the button label short so it never overflows the card; the full intent
  // lives in the tooltip.
  const removeLabel = 'Remove'
  const removeTitle = isRecipient
    ? 'Remove from my templates (revokes your access only)'
    : 'Remove template'

  const openNameModal = () => {
    setProjectName(template.name)
    setShowNameModal(true)
  }

  const handleCreateProject = async () => {
    try {
      setIsCreating(true)

      const response = await postJSON('/project/new', {
        body: {
          projectName: projectName.trim() || template.name,
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
      if (isRecipient) {
        // Recipient: drop only my own access. The template stays for its owner.
        await deleteJSON(
          `/project/${template.id}/template/shares/${currentUserId}`
        )
      } else {
        // Owner / admin: clear the template status entirely.
        await deleteJSON(`/project/${template.id}/template`)
      }
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
          <p className="card-text small flex-grow-1 template-card-description">
            {template.description}
          </p>
        )}

        {template.category && (
          <div className="mb-2 d-flex align-items-center gap-2 flex-wrap">
            {/* Recipients see who shared it; everyone else sees the category. */}
            {isRecipient && template.sharedByName ? (
              <span className="template-card-category">
                Shared by {template.sharedByName}
              </span>
            ) : (
              <span className="template-card-category">{template.category}</span>
            )}
            {isOwner && sharedCount > 0 && (
              <span className="template-card-tag" title="Shared with people">
                🔗 Shared ({sharedCount})
              </span>
            )}
          </div>
        )}

        {template.tags && template.tags.length > 0 && (
          <div className="template-tags mb-2">
            {template.tags.map(tag => (
              <span key={tag} className="template-card-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        
        <div className="mt-auto d-flex gap-2">
          <OLButton
            variant="primary"
            size="sm"
            onClick={openNameModal}
            disabled={isCreating || isRemoving}
            className="text-truncate"
            style={{ flex: '1 1 0', minWidth: 0 }}
          >
            {isCreating
              ? t('creating') + '...'
              : canShare && canRemove
                ? 'Use'
                : 'Use template'}
          </OLButton>
          {canShare && (
            <OLButton
              variant="secondary"
              size="sm"
              onClick={() => setShowShareModal(true)}
              disabled={isCreating || isRemoving}
              className="text-truncate"
              style={{ flex: '1 1 0', minWidth: 0 }}
            >
              Share
            </OLButton>
          )}
          {canRemove && (
            <OLButton
              variant="danger"
              size="sm"
              onClick={handleRemove}
              disabled={isCreating || isRemoving}
              title={removeTitle}
              className="text-truncate"
              style={{ flex: '1 1 0', minWidth: 0 }}
            >
              {isRemoving ? '...' : removeLabel}
            </OLButton>
          )}
        </div>
      </div>
      <OLModal
        show={showNameModal}
        onHide={() => setShowNameModal(false)}
        id={`template-name-modal-${template.id}`}
      >
        <OLModalHeader closeButton>
          <OLModalTitle>New project</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormControl
            type="text"
            placeholder="Project name"
            value={projectName}
            autoFocus
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setProjectName(e.target.value)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (
                e.key === 'Enter' &&
                !isCreating &&
                projectName.trim() !== ''
              ) {
                handleCreateProject()
              }
            }}
          />
        </OLModalBody>
        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setShowNameModal(false)}
            disabled={isCreating}
          >
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={handleCreateProject}
            disabled={isCreating || projectName.trim() === ''}
            isLoading={isCreating}
          >
            {t('create')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
      {showShareModal && (
        <TemplateShareModal
          templateId={template.id}
          templateName={template.name}
          onHide={() => setShowShareModal(false)}
          onSharesChanged={setSharedCount}
        />
      )}
    </div>
  )
}

export default TemplateCard
