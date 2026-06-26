import { useState, useEffect } from 'react'
import { getJSON, postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif, GitConfirm } from './GitFeedback'

const TOKEN_TYPES = [
  { value: 'github', label: 'GitHub (Personal Access Token)' },
  { value: 'gitlab', label: 'GitLab (Personal Access Token / OAuth2)' },
  { value: 'other', label: 'Autre (token générique)' },
]

function GitRemotesTab({ projectId, userId, onRefresh }) {
  const [currentRemote, setCurrentRemote] = useState(null)
  const [currentBranch, setCurrentBranch] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [tokenType, setTokenType] = useState('github')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [awaitingRemoveConfirm, setAwaitingRemoveConfirm] = useState(false)

  const hasRemote = !!currentRemote

  useEffect(() => {
    loadGitInfo()
  }, [projectId])

  const loadGitInfo = async () => {
    try {
      const info = await getJSON('/git-info?projectId=' + projectId)
      setCurrentRemote(info?.remoteUrl || null)
      setCurrentBranch(info?.branch || null)
      setRemoteUrl(info?.remoteUrl || '')
      setBranch(info?.branch || 'main')
      if (info?.tokenType) setTokenType(info.tokenType)
    } catch (err) {
      console.error('Failed to load git info:', err)
    }
  }

  const errorMessage = (err, fallback) =>
    (err && err.data && err.data.errorReason) ||
    (err && err.message) ||
    fallback

  const handleSetRemote = async () => {
    if (!remoteUrl.trim()) {
      setStatus({ type: 'error', message: 'Veuillez entrer une URL de remote.' })
      return
    }
    setIsLoading(true)
    setStatus(null)
    try {
      await postJSON('/git-set-remote', {
        body: {
          projectId,
          userId,
          remoteUrl: remoteUrl.trim(),
          branch: branch.trim() || 'main',
          token: token.trim() || undefined,
          tokenType,
        },
      })
      setStatus({ type: 'success', message: 'Remote configure avec succes.' })
      setToken('')
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err, 'Erreur lors de la configuration du remote.') })
    } finally {
      setIsLoading(false)
    }
  }

  const handleInit = async () => {
    setIsLoading(true)
    setStatus(null)
    try {
      await postJSON('/git-init', {
        body: {
          projectId,
          userId,
          remoteUrl: remoteUrl.trim() || null,
          branch: branch.trim() || 'main',
          token: token.trim() || undefined,
          tokenType,
        },
      })
      setStatus({ type: 'success', message: 'Depot git initialise.' })
      setToken('')
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err, "Erreur lors de l'initialisation du depot.") })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveConfirm = async () => {
    setAwaitingRemoveConfirm(false)
    setIsLoading(true)
    setStatus(null)
    try {
      await postJSON('/git-remove-remote', {
        body: { projectId, userId },
      })
      setStatus({ type: 'success', message: 'Remote supprime.' })
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err, 'Erreur lors de la suppression du remote.') })
    } finally {
      setIsLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '7px',
    color: 'var(--git-text)',
    backgroundColor: 'var(--git-surface)',
    border: '1px solid var(--git-border)',
    borderRadius: '4px',
  }

  return (
    <div style={{ color: 'var(--git-text-strong)', fontFamily: 'sans-serif' }}>
      <h3 style={{ marginBottom: '15px' }}>Gestion du remote</h3>

      <div
        style={{
          padding: '10px 14px',
          marginBottom: '20px',
          borderRadius: '5px',
          backgroundColor: hasRemote ? 'var(--git-success-bg)' : 'var(--git-warning-bg)',
          border: '1px solid ' + (hasRemote ? 'var(--git-success-border)' : 'var(--git-warning-border)'),
          color: hasRemote ? 'var(--git-success-text)' : 'var(--git-warning-text)',
        }}
      >
        {hasRemote ? (
          <div>
            <strong>Remote actuel</strong>
            <div style={{ fontSize: '13px', marginTop: '4px', wordBreak: 'break-all' }}>
              {currentRemote}
            </div>
            {currentBranch && (
              <div style={{ fontSize: '12px', marginTop: '2px' }}>
                Branche : {currentBranch}
              </div>
            )}
          </div>
        ) : (
          <div>
            <strong>Aucun remote configure</strong>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Definissez une URL, ou initialisez le depot si le projet n'est pas encore un repo git.
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          URL du remote
        </label>
        <input
          type="text"
          value={remoteUrl}
          onChange={e => setRemoteUrl(e.target.value)}
          placeholder="git@github.com:user/repo.git ou https://github.com/user/repo.git"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          Branche
        </label>
        <input
          type="text"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          Type de token
        </label>
        <select
          value={tokenType}
          onChange={e => setTokenType(e.target.value)}
          style={inputStyle}
        >
          {TOKEN_TYPES.map(t => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          Token (optionnel)
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="(laisser vide = conserver le token actuel / SSH)"
            style={{ ...inputStyle, flex: 1, width: 'auto' }}
          />
          <button
            onClick={() => setShowToken(v => !v)}
            style={{
              padding: '7px 10px',
              border: '1px solid var(--git-border)',
              borderRadius: '4px',
              backgroundColor: 'var(--git-surface-alt)',
              cursor: 'pointer',
              color: 'var(--git-text-strong)',
              fontSize: '12px',
            }}
          >
            {showToken ? 'Masquer' : 'Voir'}
          </button>
        </div>
      </div>

      {status && (
        <GitNotif
          type={status.type}
          message={status.message}
          onDismiss={() => setStatus(null)}
        />
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSetRemote}
          disabled={isLoading || awaitingRemoveConfirm}
          style={{
            flex: 1,
            padding: '9px',
            backgroundColor: (isLoading || awaitingRemoveConfirm) ? '#6c757d' : '#45a444',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: (isLoading || awaitingRemoveConfirm) ? 'not-allowed' : 'pointer',
            fontWeight: '500',
          }}
        >
          {isLoading ? 'Patientez...' : hasRemote ? 'Mettre a jour le remote' : 'Definir le remote'}
        </button>

        {!hasRemote && (
          <button
            onClick={handleInit}
            disabled={isLoading || awaitingRemoveConfirm}
            style={{
              padding: '9px 16px',
              backgroundColor: (isLoading || awaitingRemoveConfirm) ? '#6c757d' : '#3a7ca5',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: (isLoading || awaitingRemoveConfirm) ? 'not-allowed' : 'pointer',
            }}
          >
            Initialiser le depot git
          </button>
        )}

        {hasRemote && !awaitingRemoveConfirm && (
          <button
            onClick={() => { setAwaitingRemoveConfirm(true); setStatus(null) }}
            disabled={isLoading}
            style={{
              padding: '9px 16px',
              backgroundColor: isLoading ? '#6c757d' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Supprimer le remote
          </button>
        )}
      </div>

      {awaitingRemoveConfirm && (
        <GitConfirm
          message="Supprimer le remote ?"
          detail="Le remote origin sera retire du depot. Le token est conserve pour un re-link ulterieur."
          confirmLabel="Supprimer"
          isDanger={true}
          onConfirm={handleRemoveConfirm}
          onCancel={() => setAwaitingRemoveConfirm(false)}
        />
      )}
    </div>
  )
}

export default GitRemotesTab
