import { useState, useEffect } from 'react'
import { getJSON, postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif } from './GitFeedback'

const TOKEN_TYPES = [
  { value: 'github', label: 'GitHub (Personal Access Token)' },
  { value: 'gitlab', label: 'GitLab (Personal Access Token / OAuth2)' },
  { value: 'other', label: 'Autre (token générique)' },
]

function GitRemotesTab({ projectId, userId, onRefresh }) {
  const [currentRemote, setCurrentRemote] = useState(null)
  const [savedRemotes, setSavedRemotes] = useState([])
  const [remoteUrl, setRemoteUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [tokenType, setTokenType] = useState('github')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  const hasRepo = !!currentRemote || savedRemotes.length > 0

  useEffect(() => {
    loadGitInfo()
  }, [projectId])

  const loadGitInfo = async () => {
    try {
      const info = await getJSON('/git-info?projectId=' + projectId)
      setCurrentRemote(info?.remoteUrl || null)
      setSavedRemotes(info?.savedRemotes || [])
    } catch (err) {
      console.error('Failed to load git info:', err)
    }
  }

  const errorMessage = (err, fallback) =>
    (err && err.data && err.data.errorReason) ||
    (err && err.message) ||
    fallback

  // Ajoute (ou met à jour) un dépôt et l'active. Accepte une URL HTTPS ou SSH ;
  // l'auth derrière est gérée par le serveur (token si fourni, sinon clé SSH).
  const handleAddRemote = async () => {
    if (!remoteUrl.trim()) {
      setStatus({ type: 'error', message: 'Veuillez entrer une URL de dépôt.' })
      return
    }
    setBusy(true)
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
      setStatus({ type: 'success', message: 'Dépôt ajoute et active.' })
      setRemoteUrl('')
      setToken('')
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err, "Erreur lors de l'ajout du dépôt.") })
    } finally {
      setBusy(false)
    }
  }

  const handleInit = async () => {
    setBusy(true)
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
      setBusy(false)
    }
  }

  const handleSwitch = async url => {
    if (url === currentRemote || busy) return
    setBusy(true)
    setStatus(null)
    try {
      await postJSON('/git-switch-remote', { body: { projectId, userId, url } })
      setStatus({ type: 'success', message: 'Dépôt actif change.' })
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      await loadGitInfo()
      setStatus({ type: 'error', message: errorMessage(err, 'Echec du changement de dépôt.') })
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveSaved = async url => {
    setBusy(true)
    setStatus(null)
    try {
      await postJSON('/git-remove-saved-remote', { body: { projectId, userId, url } })
      setStatus({ type: 'success', message: 'Dépôt retire de la liste.' })
      await loadGitInfo()
      if (onRefresh) onRefresh()
    } catch (err) {
      setStatus({ type: 'error', message: errorMessage(err, 'Erreur lors de la suppression.') })
    } finally {
      setBusy(false)
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
      <h3 style={{ marginBottom: '15px' }}>Dépôts distants</h3>

      <div
        style={{
          padding: '10px 14px',
          marginBottom: '20px',
          borderRadius: '5px',
          backgroundColor: currentRemote ? 'var(--git-success-bg)' : 'var(--git-warning-bg)',
          border: '1px solid ' + (currentRemote ? 'var(--git-success-border)' : 'var(--git-warning-border)'),
          color: currentRemote ? 'var(--git-success-text)' : 'var(--git-warning-text)',
        }}
      >
        {currentRemote ? (
          <div>
            <strong>Dépôt actif</strong>
            <div style={{ fontSize: '13px', marginTop: '4px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {currentRemote}
            </div>
          </div>
        ) : (
          <div>
            <strong>Aucun dépôt actif</strong>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Ajoutez une URL (HTTPS ou SSH), ou initialisez le depot si le projet n'est pas encore un repo git.
            </div>
          </div>
        )}
      </div>

      {/* Liste des dépôts mémorisés : switch comme les branches */}
      {savedRemotes.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Changer de dépôt
          </label>
          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--git-border)',
              borderRadius: '4px',
              padding: '6px',
            }}
          >
            {savedRemotes.map((r, index) => {
              const isCurrent = r.url === currentRemote
              return (
                <div
                  key={index}
                  style={{
                    padding: '8px 10px',
                    marginBottom: '4px',
                    backgroundColor: isCurrent ? 'var(--git-selected-bg)' : 'var(--git-surface-alt)',
                    border: isCurrent ? '1px solid var(--git-accent-blue)' : '1px solid var(--git-border)',
                    borderRadius: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span
                    onClick={() => handleSwitch(r.url)}
                    title={r.url}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: 'var(--git-text-strong)',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      fontWeight: isCurrent ? 'bold' : 'normal',
                      cursor: isCurrent || busy ? 'default' : 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.url}
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--git-text-muted)' }}>
                      ({r.branch || 'main'}{r.hasToken ? ', token' : ', ssh'})
                    </span>
                  </span>
                  {isCurrent ? (
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--git-badge-text)',
                        backgroundColor: 'var(--git-badge-bg)',
                        border: '1px solid var(--git-badge-border)',
                        borderRadius: '10px',
                        padding: '1px 7px',
                        flexShrink: 0,
                      }}
                    >
                      actif
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSwitch(r.url)}
                      disabled={busy}
                      style={{
                        fontSize: '11px',
                        padding: '3px 10px',
                        backgroundColor: busy ? '#6c757d' : '#45a444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Activer
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveSaved(r.url)}
                    disabled={busy}
                    title="Retirer de la liste"
                    style={{
                      fontSize: '14px',
                      lineHeight: 1,
                      padding: '2px 7px',
                      backgroundColor: 'transparent',
                      color: 'var(--git-danger-text)',
                      border: '1px solid var(--git-danger-border)',
                      borderRadius: '4px',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ajout d'un dépôt */}
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
        Ajouter un dépôt (HTTPS ou SSH)
      </label>

      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          value={remoteUrl}
          onChange={e => setRemoteUrl(e.target.value)}
          placeholder="https://github.com/user/repo.git ou git@github.com:user/repo.git"
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          style={{ ...inputStyle, flex: '0 0 130px', width: 'auto' }}
        />
        <select
          value={tokenType}
          onChange={e => setTokenType(e.target.value)}
          style={{ ...inputStyle, flex: 1, width: 'auto' }}
        >
          {TOKEN_TYPES.map(t => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Token (optionnel ; vide = clé SSH / token conserve)"
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
        <div style={{ fontSize: '11px', color: 'var(--git-text-muted)', marginTop: '4px' }}>
          URL SSH (git@...) sans token → authentification par clé SSH. URL HTTPS → token requis pour les dépôts privés.
        </div>
      </div>

      {status && (
        <GitNotif type={status.type} message={status.message} onDismiss={() => setStatus(null)} />
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleAddRemote}
          disabled={busy}
          style={{
            flex: 1,
            padding: '9px',
            backgroundColor: busy ? '#6c757d' : '#45a444',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: '500',
          }}
        >
          {busy ? 'Patientez...' : 'Ajouter et activer'}
        </button>

        {!hasRepo && (
          <button
            onClick={handleInit}
            disabled={busy}
            style={{
              padding: '9px 16px',
              backgroundColor: busy ? '#6c757d' : '#3a7ca5',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Initialiser le depot git
          </button>
        )}
      </div>
    </div>
  )
}

export default GitRemotesTab
