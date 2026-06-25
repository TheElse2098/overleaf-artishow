import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { postJSON } from '../../../infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import { GitNotif, GitConfirm } from '../../editor-navigation-toolbar/components/GitFeedback'
import { useGitModifiedFiles } from '../contexts/git-modified-files'

type Props = {
  projectId: string
  userId: string
}

type Notif = { type: string; message: string }

const CONFIRM_MSG =
  'Le pull va intégrer les modifications du dépôt git distant. ' +
  'Vos commits locaux seront conservés via un merge. ' +
  'Les modifications non commitées seront sauvegardées (stash) et restaurées après le pull.'

// ── Formulaire d'initialisation ───────────────────────────────────────────────
function GitInitPopup({
  onConfirm,
  onCancel,
  isLoading,
}: {
  onConfirm: (remoteUrl: string | null, token: string | null) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const [wantsRemote, setWantsRemote] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [token, setToken] = useState('')

  const isHttps = remoteUrl.startsWith('https://')

  function handleConfirm() {
    if (!wantsRemote) { onConfirm(null, null); return }
    const url = remoteUrl.trim() || null
    const tok = isHttps ? (token.trim() || null) : null
    onConfirm(url, tok)
  }

  return (
    <div style={popupStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Aucun dépôt git trouvé</div>
      <div style={subtitleStyle}>
        Ce projet n'est pas encore lié à un dépôt git. Voulez-vous en initialiser un maintenant ?
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: wantsRemote ? 10 : 0, cursor: 'pointer' }}>
        <input type="checkbox" checked={wantsRemote} onChange={e => setWantsRemote(e.target.checked)} />
        Lier un dépôt distant (remote)
      </label>

      {wantsRemote && (
        <>
          <label style={labelStyle}>URL du dépôt</label>
          <input
            type="text"
            placeholder="https://github.com/user/repo.git"
            value={remoteUrl}
            onChange={e => setRemoteUrl(e.target.value)}
            style={inputStyle}
            autoFocus
          />

          {isHttps && (
            <>
              <label style={labelStyle}>
                Token d'accès
                <span style={{ fontWeight: 400, color: 'var(--content-secondary, #555)', marginLeft: 6 }}>
                  (optionnel — repo public)
                </span>
              </label>
              <input
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={token}
                onChange={e => setToken(e.target.value)}
                style={inputStyle}
              />
              {token && (
                <div style={{ fontSize: 11, color: 'var(--content-secondary, #555)', marginBottom: 8, marginTop: -6 }}>
                  {"L'URL utilisée sera : https://<TOKEN>@github.com/…"}
                </div>
              )}
            </>
          )}

          {!isHttps && remoteUrl.trim() && (
            <div style={{ fontSize: 11, color: 'var(--content-secondary, #555)', marginBottom: 8 }}>
              URL SSH détectée — aucun token requis, la clé SSH du serveur sera utilisée.
            </div>
          )}
        </>
      )}

      <div style={btnRowStyle}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={isLoading}>Annuler</button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleConfirm}
          disabled={isLoading || (wantsRemote && !remoteUrl.trim())}
        >
          {isLoading ? 'Initialisation…' : 'Initialiser'}
        </button>
      </div>
    </div>
  )
}

// ── Formulaire de liaison remote ──────────────────────────────────────────────
function GitSetRemotePopup({
  onConfirm,
  onCancel,
  isLoading,
}: {
  onConfirm: (remoteUrl: string, token: string | null) => void
  onCancel: () => void
  isLoading: boolean
}) {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [token, setToken] = useState('')

  const isHttps = remoteUrl.startsWith('https://')

  function handleConfirm() {
    const tok = isHttps ? (token.trim() || null) : null
    onConfirm(remoteUrl.trim(), tok)
  }

  return (
    <div style={popupStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Lier un dépôt distant</div>
      <div style={subtitleStyle}>
        Ce projet a un repo git local mais n'est pas encore lié à un remote. Entrez l'URL du dépôt distant.
      </div>

      <label style={labelStyle}>URL du dépôt</label>
      <input
        type="text"
        placeholder="https://github.com/user/repo.git"
        value={remoteUrl}
        onChange={e => setRemoteUrl(e.target.value)}
        style={inputStyle}
        autoFocus
      />

      {isHttps && (
        <>
          <label style={labelStyle}>
            Token d'accès
            <span style={{ fontWeight: 400, color: 'var(--content-secondary, #555)', marginLeft: 6 }}>
              (optionnel — repo public)
            </span>
          </label>
          <input
            type="password"
            placeholder="ghp_xxxxxxxxxxxx"
            value={token}
            onChange={e => setToken(e.target.value)}
            style={inputStyle}
          />
          {token && (
            <div style={{ fontSize: 11, color: 'var(--content-secondary, #555)', marginBottom: 8, marginTop: -6 }}>
              {"L'URL utilisée sera : https://<TOKEN>@github.com/…"}
            </div>
          )}
        </>
      )}

      {!isHttps && remoteUrl.trim() && (
        <div style={{ fontSize: 11, color: 'var(--content-secondary, #555)', marginBottom: 8 }}>
          URL SSH détectée — aucun token requis, la clé SSH du serveur sera utilisée.
        </div>
      )}

      <div style={btnRowStyle}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={isLoading}>Annuler</button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleConfirm}
          disabled={isLoading || !remoteUrl.trim()}
        >
          {isLoading ? 'Liaison…' : 'Lier'}
        </button>
      </div>
    </div>
  )
}

// ── Styles partagés ───────────────────────────────────────────────────────────
const popupStyle: React.CSSProperties = {
  background: 'var(--bg-light-primary, #fff)',
  border: '1px solid var(--border-primary, #ddd)',
  borderRadius: 6,
  padding: '12px 14px',
  color: 'var(--content-primary, #1a1a1a)',
  fontSize: 13,
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
}
const subtitleStyle: React.CSSProperties = {
  marginBottom: 10,
  lineHeight: 1.5,
  color: 'var(--content-secondary, #555)',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 3,
  color: 'var(--content-secondary, #555)',
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  marginBottom: 10,
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid var(--border-primary, #ccc)',
  background: 'var(--bg-light-secondary, #f5f5f5)',
  color: 'var(--content-primary, #1a1a1a)',
  fontSize: 12,
  boxSizing: 'border-box',
}
const btnRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 10,
  justifyContent: 'flex-end',
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function GitPullButton({ projectId, userId }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showInit, setShowInit] = useState(false)
  const [showSetRemote, setShowSetRemote] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notif, setNotif] = useState<Notif | null>(null)
  const [popupRect, setPopupRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const { refreshModifiedFiles } = useGitModifiedFiles()

  function openPopup() {
    if (buttonRef.current) setPopupRect(buttonRef.current.getBoundingClientRect())
  }

  function openPopup() {
    if (buttonRef.current) setPopupRect(buttonRef.current.getBoundingClientRect())
  }

  function handleClick() {
    openPopup()
    setNotif(null)
    setShowInit(false)
    setShowSetRemote(false)
    setShowConfirm(true)
  }

  async function handleConfirm() {
    setShowConfirm(false)
    setIsLoading(true)
    setNotif(null)
    openPopup()
    try {
      const response = await postJSON('/git-pull', { body: { projectId, userId } }) as any

      if (response?.notInitialized) {
        setIsLoading(false)
        setShowInit(true)
        return
      }

      if (response?.noRemote) {
        setIsLoading(false)
        setShowSetRemote(true)
        return
      }

      setNotif({ type: 'success', message: 'Pull effectué avec succès.' })
      refreshModifiedFiles()
    } catch (err: any) {
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Échec du pull.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function handleInit(remoteUrl: string | null, token: string | null) {
    setIsLoading(true)
    try {
      const response = await postJSON('/git-init', {
        body: { projectId, userId, remoteUrl, token },
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

  async function handleSetRemote(remoteUrl: string, token: string | null) {
    setIsLoading(true)
    try {
      const response = await postJSON('/git-set-remote', {
        body: { projectId, userId, remoteUrl, token },
      }) as any
      setShowSetRemote(false)
      setNotif({ type: 'success', message: response?.message ?? 'Remote lié avec succès.' })
    } catch (err: any) {
      setShowSetRemote(false)
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Échec de la liaison remote.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const popup = (showConfirm || showInit || showSetRemote || notif) && popupRect
    ? createPortal(
        <div style={{ position: 'fixed', top: popupRect.bottom + 4, left: popupRect.left, zIndex: 9999, width: '340px' }}>
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
          {showSetRemote && (
            <GitSetRemotePopup
              onConfirm={handleSetRemote}
              onCancel={() => setShowSetRemote(false)}
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
