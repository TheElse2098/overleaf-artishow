import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { postJSON, getJSON } from '../../../infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import { GitNotif, GitConfirm } from '../../editor-navigation-toolbar/components/GitFeedback'

type Props = {
  projectId: string
  userId: string
}

type Notif = { type: string; message: string }

type GitInfo = {
  remoteUrl?: string | null
  branch?: string | null
  linkedAt?: string | null
} | null

// ── Sous-composant : formulaire d'initialisation ─────────────────────────────
type InitFormProps = {
  onConfirm: (params: { remoteUrl: string; branch: string; token: string; tokenType: string }) => void
  onCancel: () => void
}

function GitInitForm({ onConfirm, onCancel }: InitFormProps) {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [token, setToken] = useState('')
  const [tokenType, setTokenType] = useState('github')

  function handleSubmit() {
    onConfirm({ remoteUrl: remoteUrl.trim(), branch: branch.trim() || 'main', token: token.trim(), tokenType })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    fontSize: '12px',
    border: '1px solid var(--border-primary, #ccc)',
    borderRadius: '4px',
    background: 'var(--bg-light-secondary, #fff)',
    color: 'var(--content-primary, #000)',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '11px', marginBottom: '2px', display: 'block', fontWeight: 600 }
  const rowStyle: React.CSSProperties = { marginBottom: '8px' }

  return (
    <div
      style={{
        background: 'var(--bg-light-primary, #fff)',
        border: '1px solid var(--border-primary, #ccc)',
        borderRadius: '6px',
        padding: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: '13px' }}>
        Initialiser le dépôt Git
      </p>
      <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--content-secondary, #555)' }}>
        Ce projet n'est pas encore lié à un dépôt Git. Renseignez les informations ci-dessous pour l'initialiser.
      </p>

      <div style={rowStyle}>
        <label style={labelStyle}>URL du dépôt distant (optionnel)</label>
        <input
          style={inputStyle}
          type="text"
          placeholder="https://github.com/... ou git@github.com:..."
          value={remoteUrl}
          onChange={e => setRemoteUrl(e.target.value)}
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>Branche</label>
        <input
          style={inputStyle}
          type="text"
          placeholder="main"
          value={branch}
          onChange={e => setBranch(e.target.value)}
        />
      </div>

      {remoteUrl && (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>Type de token (HTTPS)</label>
            <select
              style={inputStyle}
              value={tokenType}
              onChange={e => setTokenType(e.target.value)}
            >
              <option value="github">GitHub (x-access-token)</option>
              <option value="gitlab">GitLab (oauth2)</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Token d'accès (optionnel — ignoré si SSH)</label>
            <input
              style={inputStyle}
              type="password"
              placeholder="ghp_... ou token GitLab"
              value={token}
              onChange={e => setToken(e.target.value)}
            />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          style={{ fontSize: '12px' }}
        >
          Annuler
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          style={{ fontSize: '12px' }}
        >
          Initialiser
        </button>
      </div>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
const PULL_CONFIRM_MSG =
  'Le pull va intégrer les modifications du dépôt git distant. ' +
  'Vos commits locaux seront conservés via un merge. ' +
  'Les modifications non commitées seront sauvegardées (stash) et restaurées après le pull.'

type Step =
  | 'idle'
  | 'checking'       // GET /git-info en cours
  | 'confirm-pull'   // repo déjà lié → confirmer le pull
  | 'init-form'      // repo non lié → afficher le formulaire d'init
  | 'confirm-init'   // formulaire rempli → confirmer l'init
  | 'loading'        // opération en cours

export default function GitPullButton({ projectId, userId }: Props) {
  const [step, setStep] = useState<Step>('idle')
  const [notif, setNotif] = useState<Notif | null>(null)
  const [popupRect, setPopupRect] = useState<DOMRect | null>(null)
  const [gitInfo, setGitInfo] = useState<GitInfo>(null)
  const [initParams, setInitParams] = useState<{ remoteUrl: string; branch: string; token: string; tokenType: string } | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)

  function captureRect() {
    if (buttonRef.current) {
      setPopupRect(buttonRef.current.getBoundingClientRect())
    }
  }

  async function handleClick() {
    captureRect()
    setNotif(null)
    setStep('checking')

    try {
      const info: GitInfo = await getJSON(`/git-info?projectId=${projectId}`)
      setGitInfo(info)
      if (info?.linkedAt) {
        setStep('confirm-pull')
      } else {
        setStep('init-form')
      }
    } catch {
      setNotif({ type: 'error', message: 'Impossible de vérifier l\'état git du projet.' })
      setStep('idle')
    }
  }

  async function handleConfirmPull() {
    setStep('loading')
    captureRect()
    try {
      await postJSON('/git-pull', { body: { projectId, userId } })
      setNotif({ type: 'success', message: 'Pull effectué avec succès.' })
    } catch (err: any) {
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Échec du pull.',
      })
    } finally {
      setStep('idle')
    }
  }

  function handleInitFormConfirm(params: { remoteUrl: string; branch: string; token: string; tokenType: string }) {
    setInitParams(params)
    captureRect()
    setStep('confirm-init')
  }

  async function handleConfirmInit() {
    if (!initParams) return
    setStep('loading')
    captureRect()
    try {
      const result: any = await postJSON('/git-init', {
        body: {
          projectId,
          userId,
          remoteUrl: initParams.remoteUrl || null,
          branch: initParams.branch || 'main',
          token: initParams.token || null,
          tokenType: initParams.tokenType || null,
        },
      })
      const msg = result?.message || 'Dépôt git initialisé avec succès.'
      setNotif({ type: 'success', message: msg })
    } catch (err: any) {
      setNotif({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Échec de l\'initialisation git.',
      })
    } finally {
      setStep('idle')
    }
  }

  function handleCancel() {
    setStep('idle')
  }

  const isLoading = step === 'loading' || step === 'checking'
  const showPopup = step !== 'idle' && step !== 'checking' && step !== 'loading'

  const popup =
    showPopup && popupRect
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: popupRect.bottom + 4,
              left: popupRect.left,
              zIndex: 9999,
              width: '340px',
            }}
          >
            {step === 'confirm-pull' && (
              <GitConfirm
                message="Confirmer le pull ?"
                detail={PULL_CONFIRM_MSG}
                confirmLabel="Pull"
                isDanger={false}
                onConfirm={handleConfirmPull}
                onCancel={handleCancel}
              />
            )}
            {step === 'init-form' && (
              <GitInitForm onConfirm={handleInitFormConfirm} onCancel={handleCancel} />
            )}
            {step === 'confirm-init' && initParams && (
              <GitConfirm
                message="Confirmer l'initialisation ?"
                detail={
                  initParams.remoteUrl
                    ? `Un repo git sera créé localement et lié au remote "${initParams.remoteUrl}" (branche : ${initParams.branch}).`
                    : `Un repo git local sera créé pour ce projet (branche : ${initParams.branch}). Aucun remote ne sera configuré.`
                }
                confirmLabel="Initialiser"
                isDanger={false}
                onConfirm={handleConfirmInit}
                onCancel={() => setStep('init-form')}
              />
            )}
          </div>,
          document.body
        )
      : null

  const notifPortal =
    notif && popupRect
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: popupRect.bottom + 4,
              left: popupRect.left,
              zIndex: 9999,
              width: '340px',
            }}
          >
            <GitNotif
              type={notif.type}
              message={notif.message}
              onDismiss={() => setNotif(null)}
            />
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
        title={gitInfo?.linkedAt ? 'Pull' : 'Git'}
        style={{ opacity: isLoading ? 0.6 : 1, color: 'var(--file-tree-expand-button-color)' }}
      >
        <MaterialIcon
          type={isLoading ? 'sync' : gitInfo?.linkedAt ? 'repeat' : 'source_branch'}
          fw
          accessibilityLabel={gitInfo?.linkedAt ? 'pull' : 'git init'}
        />
      </button>
      {popup}
      {notifPortal}
    </div>
  )
}
