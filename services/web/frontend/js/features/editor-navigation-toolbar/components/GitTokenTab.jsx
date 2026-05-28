import { useState, useEffect } from 'react'
import { getJSON, postJSON } from '../../../infrastructure/fetch-json'

const TOKEN_TYPES = [
  { value: 'github', label: 'GitHub (Personal Access Token)' },
  { value: 'gitlab', label: 'GitLab (Personal Access Token / OAuth2)' },
]

function GitTokenTab({ projectId, userId }) {
  const [token, setToken] = useState('')
  const [tokenType, setTokenType] = useState('github')
  const [hasExistingToken, setHasExistingToken] = useState(false)
  const [existingTokenType, setExistingTokenType] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message: string }
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    loadGitInfo()
  }, [projectId])

  const loadGitInfo = async () => {
    try {
      const info = await getJSON(`/git-info?projectId=${projectId}`)
      if (info?.token) {
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
      setStatus({ type: 'success', message: 'Token sauvegardé avec succès.' })
      setHasExistingToken(true)
      setExistingTokenType(tokenType)
      setToken('')
    } catch (err) {
      setStatus({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Erreur lors de la sauvegarde.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm('Supprimer le token ? Le projet utilisera la clé SSH.')) return

    setIsLoading(true)
    setStatus(null)

    try {
      await postJSON('/git-save-token', {
        body: { projectId, token: null, tokenType: null },
      })
      setStatus({ type: 'success', message: 'Token supprimé. Authentification SSH active.' })
      setHasExistingToken(false)
      setExistingTokenType(null)
      setToken('')
    } catch (err) {
      setStatus({
        type: 'error',
        message: err?.data?.errorReason || err?.message || 'Erreur lors de la suppression.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ color: 'black', fontFamily: 'sans-serif' }}>
      <h3 style={{ marginBottom: '15px' }}>Authentification par Token</h3>

      {/* Statut actuel */}
      <div
        style={{
          padding: '10px 14px',
          marginBottom: '20px',
          borderRadius: '5px',
          backgroundColor: hasExistingToken ? '#d4edda' : '#fff3cd',
          border: `1px solid ${hasExistingToken ? '#c3e6cb' : '#ffeeba'}`,
          color: hasExistingToken ? '#155724' : '#856404',
        }}
      >
        {hasExistingToken ? (
          <>
            <strong>Token configuré</strong>
            {existingTokenType && (
              <span style={{ marginLeft: '8px', fontSize: '13px' }}>
                ({TOKEN_TYPES.find(t => t.value === existingTokenType)?.label || existingTokenType})
              </span>
            )}
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Le push/pull utilise l'authentification HTTPS par token.
            </div>
          </>
        ) : (
          <>
            <strong>Aucun token configuré</strong>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Le push/pull utilise la clé SSH.
            </div>
          </>
        )}
      </div>

      {/* Formulaire */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
          Type de token
        </label>
        <select
          value={tokenType}
          onChange={e => setTokenType(e.target.value)}
          style={{
            width: '100%',
            padding: '7px',
            color: 'dimgray',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
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
          {hasExistingToken ? 'Nouveau token (laisser vide pour conserver l'actuel)' : 'Token'}
        </label>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={hasExistingToken ? '••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
            style={{
              flex: 1,
              padding: '7px',
              color: 'dimgray',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <button
            onClick={() => setShowToken(v => !v)}
            style={{
              padding: '7px 10px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: '#f8f9fa',
              cursor: 'pointer',
              color: 'black',
              fontSize: '12px',
            }}
          >
            {showToken ? 'Masquer' : 'Voir'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: 'gray', marginTop: '4px' }}>
          Le token est chiffré et jamais affiché après sauvegarde.
        </div>
      </div>

      {/* Info token GitHub / GitLab */}
      <div
        style={{
          padding: '10px',
          marginBottom: '18px',
          backgroundColor: '#f0f8ff',
          border: '1px solid #bee3f8',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#2c5282',
        }}
      >
        {tokenType === 'github' ? (
          <>
            <strong>GitHub :</strong> Créez un token sur{' '}
            <em>Settings → Developer settings → Personal access tokens</em>.
            Cochez les permissions <code>repo</code>.
          </>
        ) : (
          <>
            <strong>GitLab :</strong> Créez un token sur{' '}
            <em>User Settings → Access Tokens</em>.
            Cochez les permissions <code>read_repository</code> et <code>write_repository</code>.
          </>
        )}
      </div>

      {/* Feedback */}
      {status && (
        <div
          style={{
            padding: '10px',
            marginBottom: '15px',
            borderRadius: '4px',
            backgroundColor: status.type === 'success' ? '#d4edda' : '#f8d7da',
            border: `1px solid ${status.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
            color: status.type === 'success' ? '#155724' : '#721c24',
          }}
        >
          {status.message}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSave}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '9px',
            backgroundColor: isLoading ? '#6c757d' : '#45a444',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: '500',
          }}
        >
          {isLoading ? 'Sauvegarde...' : hasExistingToken ? 'Mettre à jour le token' : 'Sauvegarder le token'}
        </button>

        {hasExistingToken && (
          <button
            onClick={handleRemove}
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
    </div>
  )
}

export default GitTokenTab
