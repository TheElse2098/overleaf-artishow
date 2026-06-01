import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { postJSON } from '../../../infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import { GitNotif, GitConfirm } from '../../editor-navigation-toolbar/components/GitFeedback'

type Props = {
  projectId: string
  userId: string
}

type Notif = { type: string; message: string }

const CONFIRM_MSG =
  'Le pull va intégrer les modifications du dépôt git distant. ' +
  'Vos commits locaux seront conservés via un merge. ' +
  'Les modifications non commitées seront sauvegardées (stash) et restaurées apres le pull.'

export default function GitPullButton({ projectId, userId }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notif, setNotif] = useState<Notif | null>(null)
  const [popupRect, setPopupRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)

  function handleClick() {
    if (buttonRef.current) {
      setPopupRect(buttonRef.current.getBoundingClientRect())
    }
    setNotif(null)
    setShowConfirm(true)
  }

  async function handleConfirm() {
    setShowConfirm(false)
    setIsLoading(true)
    setNotif(null)
    if (buttonRef.current) {
      setPopupRect(buttonRef.current.getBoundingClientRect())
    }
    try {
      await postJSON('/git-pull', { body: { projectId, userId } })
      setNotif({ type: 'success', message: 'Pull effectue avec succes.' })
    } catch (err: any) {
      setNotif({
        type: 'error',
        message:
          (err?.data?.errorReason) ||
          (err?.message) ||
          'Echec du pull.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const popup = (showConfirm || notif) && popupRect
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            top: popupRect.bottom + 4,
            left: popupRect.left,
            zIndex: 9999,
            width: '320px',
          }}
        >
          {showConfirm && (
            <GitConfirm
              message="Confirmer le pull ?"
              detail={CONFIRM_MSG}
              confirmLabel="Pull"
              isDanger={false}
              onConfirm={handleConfirm}
              onCancel={() => setShowConfirm(false)}
            />
          )}
          {notif && (
            <GitNotif
              type={notif.type}
              message={notif.message}
              onDismiss={() => setNotif(null)}
            />
          )}
        </div>,
        document.body
      )
    : null

  return (
    <div ref={buttonRef} style={{ display: 'inline-block' }}>
      <button
        className="btn"
        onClick={handleClick}
        disabled={isLoading}
        title="Pull"
        style={{ opacity: isLoading ? 0.6 : 1, color: 'var(--file-tree-expand-button-color)' }}
      >
        <MaterialIcon type="repeat" fw accessibilityLabel="pull" />
      </button>
      {popup}
    </div>
  )
}
