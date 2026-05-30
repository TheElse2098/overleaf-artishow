import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif, GitConfirm } from './GitFeedback'

function GitRollbackTab({ projectId, userId, commitHistory, onClose }) {
  var [selectedCommit, setSelectedCommit] = useState('')
  var [isLoading, setIsLoading] = useState(false)
  var [notification, setNotification] = useState(null)
  var [awaitingConfirm, setAwaitingConfirm] = useState(false)

  function showNotif(type, message) {
    setNotification({ type: type, message: message })
  }

  function handleSelectCommit(hash) {
    setSelectedCommit(hash)
    setAwaitingConfirm(false)
    setNotification(null)
  }

  function handleRollbackRequest() {
    if (!selectedCommit) {
      showNotif('warning', 'Selectionnez un commit avant de faire un rollback.')
      return
    }
    setAwaitingConfirm(true)
  }

  async function handleRollbackConfirm() {
    setAwaitingConfirm(false)
    setIsLoading(true)
    setNotification(null)
    try {
      var response = await postJSON('/git-rollback', {
        body: { projectId: projectId, userId: userId, commitHash: selectedCommit },
      })
      if (response.success) {
        showNotif('success', 'Rollback effectue. Rechargement...')
        setTimeout(function() {
          onClose()
          window.location.reload()
        }, 1200)
      } else {
        showNotif('error', response.error || 'Le rollback a echoue.')
      }
    } catch (err) {
      showNotif('error', 'Rollback echoue : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      {notification && (
        <GitNotif
          type={notification.type}
          message={notification.message}
          onDismiss={function() { setNotification(null) }}
        />
      )}

      <div style={{ marginBottom: '12px' }}>
        <h3 style={{ color: 'black', marginBottom: '10px', fontSize: '14px' }}>Commits recents</h3>
        <div
          style={{
            maxHeight: '280px',
            overflowY: 'auto',
            border: '1px solid #ddd',
            padding: '8px',
            borderRadius: '4px',
          }}
        >
          {commitHistory.length > 0 ? (
            commitHistory.map(function(commit, index) {
              var isSelected = selectedCommit === commit.hash
              return (
                <div
                  key={commit.hash || index}
                  onClick={function() { handleSelectCommit(commit.hash) }}
                  style={{
                    marginBottom: '8px',
                    padding: '10px',
                    border: isSelected ? '2px solid #007bff' : '1px solid #eee',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#f0f8ff' : 'white',
                  }}
                >
                  <div style={{ fontWeight: 'bold', color: '#007bff', fontSize: '12px', fontFamily: 'monospace' }}>
                    {commit.hash.substring(0, 7)}
                  </div>
                  <div style={{ color: 'black', marginTop: '4px', fontWeight: '500', fontSize: '13px' }}>
                    {commit.message || 'No commit message'}
                  </div>
                  {commit.author && (
                    <div style={{ color: 'gray', fontSize: '11px', marginTop: '2px' }}>
                      by {commit.author}
                    </div>
                  )}
                  {commit.date && (
                    <div style={{ color: 'gray', fontSize: '11px', marginTop: '2px' }}>
                      {new Date(commit.date).toLocaleString()}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <div style={{ color: 'gray', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
              Aucun commit disponible
            </div>
          )}
        </div>
      </div>

      {selectedCommit && !awaitingConfirm && (
        <button
          onClick={handleRollbackRequest}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: isLoading ? '#6c757d' : '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: '500',
            fontSize: '13px',
          }}
        >
          {isLoading ? 'Rollback en cours...' : 'Rollback vers ' + selectedCommit.substring(0, 7)}
        </button>
      )}

      {awaitingConfirm && (
        <GitConfirm
          message="Confirmer le rollback ?"
          detail={'Toutes les modifications apres le commit ' + selectedCommit.substring(0, 7) + ' seront perdues definitivement.'}
          confirmLabel="Rollback"
          isDanger={true}
          onConfirm={handleRollbackConfirm}
          onCancel={function() { setAwaitingConfirm(false) }}
        />
      )}
    </div>
  )
}

export default GitRollbackTab
