import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif } from './GitFeedback'

function GitBranchesTab({ projectId, userId, branches, selectedBranch, onRefresh }) {
  var [newBranchName, setNewBranchName] = useState('')
  var [isCreating, setIsCreating] = useState(false)
  var [isSwitching, setIsSwitching] = useState(false)
  var [notification, setNotification] = useState(null)

  function showNotif(type, message) {
    setNotification({ type: type, message: message })
  }

  async function handleSelectBranch(branchName) {
    if (branchName === selectedBranch) return
    setIsSwitching(true)
    setNotification(null)
    try {
      await postJSON('/git-switch-branch', {
        body: { projectId: projectId, userId: userId, branchName: branchName },
      })
      await onRefresh()
      showNotif('success', 'Branche changee : ' + branchName)
    } catch (err) {
      await onRefresh()
      showNotif('error', 'Echec du changement de branche : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsSwitching(false)
    }
  }

  async function handleCreateBranch() {
    var name = newBranchName.trim()
    if (!name) {
      showNotif('warning', 'Le nom de branche ne peut pas etre vide.')
      return
    }
    setIsCreating(true)
    setNotification(null)
    try {
      await postJSON('/git-create-branch', {
        body: { projectId: projectId, userId: userId, newBranchName: name },
      })
      setNewBranchName('')
      await onRefresh()
      showNotif('success', 'Branche cree et activee : ' + name)
    } catch (err) {
      showNotif('error', 'Echec de la creation : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsCreating(false)
    }
  }

  var isBusy = isCreating || isSwitching

  return (
    <div>
      {notification && (
        <GitNotif
          type={notification.type}
          message={notification.message}
          onDismiss={function() { setNotification(null) }}
        />
      )}

      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: 'var(--git-text-strong)', fontWeight: '500', marginBottom: '10px' }}>
          Branche active : <span style={{ color: '#45a444', fontFamily: 'monospace' }}>{selectedBranch || '...'}</span>
        </div>
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label style={{ display: 'block', color: 'var(--git-text-strong)', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
          Creer une nouvelle branche
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newBranchName}
            onChange={function(e) { setNewBranchName(e.target.value) }}
            onKeyDown={function(e) { if (e.key === 'Enter') handleCreateBranch() }}
            placeholder="nom-de-branche"
            disabled={isBusy}
            style={{
              flex: 1,
              padding: '7px',
              color: 'var(--git-text)',
              backgroundColor: 'var(--git-surface)',
              border: '1px solid var(--git-border)',
              borderRadius: '4px',
              fontSize: '13px',
            }}
          />
          <button
            onClick={handleCreateBranch}
            disabled={isBusy}
            style={{
              padding: '7px 14px',
              backgroundColor: isBusy ? '#ccc' : '#45a444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              whiteSpace: 'nowrap',
            }}
          >
            {isCreating ? 'Creation...' : 'Creer'}
          </button>
        </div>
      </div>

      <div>
        <label style={{ display: 'block', color: 'var(--git-text-strong)', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
          Changer de branche
        </label>
        {branches.length === 0 ? (
          <div style={{ color: 'var(--git-text-muted)', fontSize: '13px', fontStyle: 'italic' }}>Chargement...</div>
        ) : (
          <div
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              border: '1px solid var(--git-border)',
              borderRadius: '4px',
              padding: '6px',
            }}
          >
            {branches.map(function(branch, index) {
              var isCurrent = branch === selectedBranch
              return (
                <div
                  key={index}
                  onClick={function() { if (!isBusy) handleSelectBranch(branch) }}
                  style={{
                    padding: '8px 10px',
                    marginBottom: '4px',
                    backgroundColor: isCurrent ? 'var(--git-selected-bg)' : 'var(--git-surface-alt)',
                    border: isCurrent ? '1px solid var(--git-accent-blue)' : '1px solid var(--git-border)',
                    borderRadius: '4px',
                    cursor: isBusy ? 'not-allowed' : (isCurrent ? 'default' : 'pointer'),
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--git-text-strong)',
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      fontWeight: isCurrent ? 'bold' : 'normal',
                    }}
                  >
                    {branch}
                  </span>
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--git-badge-text)',
                        backgroundColor: 'var(--git-badge-bg)',
                        border: '1px solid var(--git-badge-border)',
                        borderRadius: '10px',
                        padding: '1px 7px',
                      }}
                    >
                      active
                    </span>
                  )}
                  {isSwitching && !isCurrent && (
                    <span style={{ fontSize: '11px', color: 'var(--git-text-muted)' }}>...</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default GitBranchesTab
