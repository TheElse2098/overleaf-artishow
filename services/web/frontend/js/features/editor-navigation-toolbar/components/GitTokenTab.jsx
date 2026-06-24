import { useState, useEffect } from 'react'
import { getJSON, postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif, GitConfirm } from './GitFeedback'

const TOKEN_TYPES = [
  { value: 'github', label: 'GitHub (Personal Access Token)' },
  { value: 'gitlab', label: 'GitLab (Personal Access Token / OAuth2)' },
]

function GitTokenTab({ projectId }) {
  const [token, setToken] = useState('')
  const [tokenType, setTokenType] = useState('github')
  const [hasExistingToken, setHasExistingToken] = useState(false)
  const [existingTokenType, setExistingTokenType] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [showToken, setShowToken] = useState(false)
  const [awaitingRemoveConfirm, setAwaitingRemoveConfirm] = useState(false)

  useEffect(() => {
    loadGitInfo()
  }, [projectId])

  const loadGitInfo = async () => {
    try {
      const info = await getJSON('/git-info?projectId=' + projectId)
      if (info && info.hasToken) {
        setHasExistingToken(true)
        setExistingTokenType(info.tokenType || 'github')
        setTokenType(info.tokenType || 'github')
      } else {
        setHasExistingToken(false)
      }
    } catch (err) {
      console.error('Failed to load git info:', err)
    }
  }

  const handleSave = async () => {
    if (!token.trim() && !hasExistingToken) {
      setStatus({ type: 'error', message: 'Veuillez entrer un token.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      await postJSON('/git-save-token', {
        body: {
          projectId,
          token: token.trim() || undefined,
          tokenType,
        },
      })
      setStatus({ type: 'success', message: 'Token sauvegarde avec succes.' })
      setHasExistingToken(true)
      setExistingTokenType(tokenType)
      setToken('')
    } catch (err) {
      setStatus({
        type: 'error',
        message:
          (err && err.data && err.data.errorReason) ||
          (err && err.message) ||
          'Erreur lors de la sauvegarde.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveRequest = () => {
    setAwaitingRemoveConfirm(true)
    setStatus(null)
  }

  const handleRemoveConfirm = async () => {
    setAwaitingRemoveConfirm(false)
    setIsLoading(true)
    setStatus(null)

    try {
      await postJSON('/git-save-token', {
        body: { projectId, token: null, tokenType: null },
      })
      setStatus({ type: 'success', message: 'Token supprime. Authentification SSH active.' })
      setHasExistingToken(false)
      setExistingTokenType(null)
      setToken('')
    } catch (err) {
      setStatus({
        type: 'error',
        message:
          (err && err.data && err.data.errorReason) ||
          (err && err.message) ||
          'Erreur lors de la suppression.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const tokenTypeLabel = TOKEN_TYPES.find(function(t) { return t.value === existingTokenType })
  const githubInfo = 'GitHub : Settings > Developer settings > Personal access tokens. Permission requise : repo.'
  const gitlabInfo = 'GitLab : User Settings > Access Tokens. Permissions : read_repository, write_repository.'

  return (
    <div style={{ color: 'var(--git-text-strong)', fontFamily: 'sans-serif' }}>
      <h3 style={{ marginBottom: '15px' }}>Authentification par Token</h3>

      <div
        style={{
          padding: '10px 14px',
          marginBottom: '20px',
          borderRadius: '5px',
          backgroundColor: hasExistingToken ? '#d4edda' : '#fff3cd',
          border: '1px solid ' + (hasExistingToken ? '#c3e6cb' : '#ffeeba'),
          color: hasExistingToken ? '#155724' : '#856404',
        }}
      >
        {hasExistingToken ? (
          <div>
            <strong>Token configure</strong>
            {tokenTypeLabel && (
              <span style={{ marginLeft: '8px', fontSize: '13px' }}>
                ({tokenTypeLabel.label})
              </span>
            )}
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Push/pull utilise HTTPS avec token.
            </div>
          </div>
        ) : (
          <div>
            <strong>Aucun token configure</strong>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Push/pull utilise la cle SSH.
            </div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          Type de token
        </label>
        <select
          value={tokenType}
          onChange={function(e) { setTokenType(e.target.value) }}
          style={{
            width: '100%',
            padding: '7px',
            color: 'var(--git-text)',
            backgroundColor: 'var(--git-surface)',
            border: '1px solid var(--git-border)',
            borderRadius: '4px',
          }}
        >
          {TOKEN_TYPES.map(function(t) {
            return (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            )
          })}
        </select>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          {hasExistingToken ? 'Nouveau token (vide = conserver actuel)' : 'Token'}
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={function(e) { setToken(e.target.value) }}
            placeholder={hasExistingToken ? '(inchange)' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
            style={{
              flex: 1,
              padding: '7px',
              color: 'var(--git-text)',
              backgroundColor: 'var(--git-surface)',
              border: '1px solid var(--git-border)',
              borderRadius: '4px',
            }}
          />
          <button
            onClick={function() { setShowToken(function(v) { return !v }) }}
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

      <div
        style={{
          padding: '10px',
          marginBottom: '18px',
          backgroundColor: 'var(--git-info-bg)',
          border: '1px solid var(--git-info-border)',
          borderRadius: '4px',
          fontSize: '12px',
          color: 'var(--git-info-text)',
        }}
      >
        {tokenType === 'github' ? githubInfo : gitlabInfo}
      </div>

      {status && (
        <GitNotif
          type={status.type}
          message={status.message}
          onDismiss={function() { setStatus(null) }}
        />
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSave}
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
          {isLoading ? 'Sauvegarde...' : hasExistingToken ? 'Mettre a jour le token' : 'Sauvegarder le token'}
        </button>

        {hasExistingToken && !awaitingRemoveConfirm && (
          <button
            onClick={handleRemoveRequest}
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
            Supprimer
          </button>
        )}
      </div>

      {awaitingRemoveConfirm && (
        <GitConfirm
          message="Supprimer le token ?"
          detail="Le projet utilisera la cle SSH pour les operations Git."
          confirmLabel="Supprimer"
          isDanger={true}
          onConfirm={handleRemoveConfirm}
          onCancel={function() { setAwaitingRemoveConfirm(false) }}
        />
      )}
    </div>
  )
}

export default GitTokenTab
