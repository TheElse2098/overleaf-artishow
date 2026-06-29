// template-share-modal.tsx
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import Notification from '@/shared/components/notification'
import {
  getJSON,
  postJSON,
  deleteJSON,
} from '../../../../infrastructure/fetch-json'

type Share = {
  userId: string
  email: string
  name: string
  status?: 'pending' | 'accepted'
}

type TemplateShareModalProps = {
  templateId: string
  templateName: string
  onHide: () => void
  // Lets the card update its "Shared (N)" badge as shares change.
  onSharesChanged?: (count: number) => void
}

function TemplateShareModal({
  templateId,
  templateName,
  onHide,
  onSharesChanged,
}: TemplateShareModalProps) {
  const { t } = useTranslation()
  const [shares, setShares] = useState<Share[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const notifyCount = useCallback(
    (next: Share[]) => {
      onSharesChanged?.(next.length)
    },
    [onSharesChanged]
  )

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setLoading(true)
        const response = await getJSON(
          `/project/${templateId}/template/shares`
        )
        if (active) setShares(response.shares || [])
      } catch (err) {
        if (active) setError('Failed to load the share list.')
        console.error('Error fetching template shares:', err)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [templateId])

  const errorMessageFor = (err: any): string => {
    const code = err?.data?.error
    switch (code) {
      case 'no_user':
        return 'No user found with this email address.'
      case 'invalid_target':
        return 'You cannot share a template with its owner.'
      case 'email_required':
        return 'Please enter an email address.'
      default:
        return 'Something went wrong. Please try again.'
    }
  }

  const handleAdd = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter an email address.')
      return
    }
    if (shares.some(s => s.email.toLowerCase() === trimmed.toLowerCase())) {
      setError('This template is already shared with that person.')
      return
    }
    setError(null)
    setAdding(true)
    try {
      const response = await postJSON(
        `/project/${templateId}/template/shares`,
        { body: { email: trimmed } }
      )
      const next = [...shares, response.share]
      setShares(next)
      notifyCount(next)
      setEmail('')
    } catch (err) {
      setError(errorMessageFor(err))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId: string) => {
    setError(null)
    setRemovingId(userId)
    try {
      await deleteJSON(`/project/${templateId}/template/shares/${userId}`)
      const next = shares.filter(s => s.userId !== userId)
      setShares(next)
      notifyCount(next)
    } catch (err) {
      setError('Could not revoke access. Please try again.')
      console.error('Error removing template share:', err)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <OLModal
      show
      animation
      onHide={onHide}
      id={`template-share-modal-${templateId}`}
      backdrop="static"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>Share “{templateName}”</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {error && (
          <div className="notification-list mb-3">
            <Notification type="error" content={error} />
          </div>
        )}

        <label className="form-label" htmlFor={`share-email-${templateId}`}>
          Add people
        </label>
        <div className="d-flex gap-2 mb-3">
          <OLFormControl
            id={`share-email-${templateId}`}
            type="email"
            placeholder="email@example.com"
            value={email}
            autoFocus
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEmail(e.target.value)
            }
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' && !adding) {
                handleAdd()
              }
            }}
          />
          <OLButton
            variant="primary"
            onClick={handleAdd}
            disabled={adding || email.trim() === ''}
            isLoading={adding}
          >
            Add
          </OLButton>
        </div>

        <label className="form-label">People with access</label>
        {loading ? (
          <p className="text-muted small mb-0">Loading…</p>
        ) : shares.length === 0 ? (
          <p className="text-muted small mb-0">
            This template isn’t shared with anyone yet.
          </p>
        ) : (
          <ul className="list-unstyled mb-2">
            {shares.map(share => (
              <li
                key={share.userId}
                className="d-flex align-items-center justify-content-between py-1"
              >
                <span className="text-truncate" title={share.email}>
                  {share.name !== share.email
                    ? `${share.name} (${share.email})`
                    : share.email}
                  {share.status === 'pending' && (
                    <span className="text-muted small ms-2">(en attente)</span>
                  )}
                </span>
                <OLButton
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(share.userId)}
                  disabled={removingId === share.userId}
                  aria-label={`Remove access for ${share.email}`}
                >
                  {removingId === share.userId ? '…' : '✕'}
                </OLButton>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted small mb-0">
          These people will be able to create a project from this template
          (read-only).
        </p>
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default TemplateShareModal
