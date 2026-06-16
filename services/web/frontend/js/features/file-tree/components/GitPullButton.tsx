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

// Popup d'initialisation : case à cocher optionnelle pour lier un remote
function GitInitPopup({
  onConfirm,
  onCancel,
  isLoading,
}: {
  onConfirm: (remoteUrl: string | null) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const [wantsRemote, setWantsRemote] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')

  function handleSubmit() {
    const url = wantsRemote && remoteUrl.trim() ? remoteUrl.trim() : null
    onConfirm(url)
  }

  return (
    <div style={{ background: 'var(--bg-dark-secondary, #2c2c2c)', border: '1px solid var(--border-primary, #444)', borderRadius: 6, padding: '12px 14px', color: 'var(--content-primary, #eee)', fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucun dépôt git trouvé</div>
      <div style={{ marginBottom: 10, lineHeight: 1.5, color: 'var(--content-secondary, #aaa)' }}>
        Ce projet n'est pas encore lié à un dépôt git. Voulez-vous en initialiser un maintenant ?
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: wantsRemote ? 8 : 0, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={wantsRemote}
          onChange={e => setWantsRemote(e.target.checked)}
        />
        Lier un dépôt distant (remote)
      </label>

      {wantsRemote && (
        <input
          type="text"
          placeholder="git@github.com:user/repo.git"
          value={remoteUrl}
          onChange={e => setRemoteUrl(e.target.value)}
          style={{
            width: '100%',
            marginBottom: 10,
            padding: '5px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-primary, #555)',
            background: 'var(--bg-dark-primary, #1e1e1e)',
            color: 'var(--content-primary, #eee)',
            fontSize: 12,
            boxSizing: 'border-box',
          }}
          autoFocus
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          disabled={isLoading}
        >
          Annuler
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isLoading || (wantsRemote && !remoteUrl.trim())}
        >
          {isLoading ? 'Initialisation…' : 'Initialiser'}
        </button>
      </div>
    </div>
  )
}

export default function GitPullButton({ projectId, userId }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showInit, setShowInit] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notif, setNotif] = useState<Notif | null>(null)
  const [popupRect, setPopupRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)

  function openPopup() {
    if (buttonRef.current) {
      setPopupRect(buttonRef.current.getBoundingClientRect())
    }
  }

  function handleClick() {
    openPopup()
    setNotif(null)
    setShowInit(false)
    setShowConfirm(true)
  }

  async function handleConfirm() {
    setShowConfirm(false)
    setIsLoading(true)
    setNotif(null)
    openPopup()
    try {
      const response = await postJSON('/git-pull', { body: { projectId, userId } }) as any

      // Le backend signale qu'aucun repo git n'existe : on propose l'initialisation
      if (response?.notInitialized) {
        setShowInit(true)
        return
      }

      setNotif({ type: 'success', message: 'Pull effectué avec succès.' })
    } catch (err: any) {
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Échec du pull.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function handleInit(remoteUrl: string | null) {
    setIsLoading(true)
    try {
      const response = await postJSON('/git-init', {
        body: { projectId, userId, remoteUrl },
      }) as any
      setShowInit(false)
      setNotif({ type: 'success', message: response?.message ?? 'Dépôt initialisé avec succès.' })
    } catch (err: any) {
      setShowInit(false)
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || "Échec de l'initialisation.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const popup = (showConfirm || showInit || notif) && popupRect
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
          {showInit && (
            <GitInitPopup
              onConfirm={handleInit}
              onCancel={() => setShowInit(false)}
              isLoading={isLoading}
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
