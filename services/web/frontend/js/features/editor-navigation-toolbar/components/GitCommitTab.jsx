import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif } from './GitFeedback'

var BTN_BASE = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: '500',
  fontSize: '13px',
}

var BTN_GREEN = Object.assign({}, BTN_BASE, { backgroundColor: '#45a444', color: 'white' })
var BTN_OUTLINE = Object.assign({}, BTN_BASE, {
  backgroundColor: 'transparent',
  color: '#45a444',
  border: '1px solid #45a444',
})

function FileRow({ filePath, checked, onToggle, onAddOne, isAdding }) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 6px',
        borderRadius: '4px',
        backgroundColor: checked ? '#f0faf0' : 'transparent',
        marginBottom: '2px',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={function() { onToggle(filePath) }}
        style={{ cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{ color: 'black', flex: 1, fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {filePath}
      </span>
      <button
        onClick={function() { onAddOne(filePath) }}
        disabled={isAdding}
        title="Ajouter ce fichier"
        style={Object.assign({}, BTN_BASE, {
          padding: '3px 8px',
          fontSize: '12px',
          backgroundColor: isAdding ? '#ccc' : '#e8f5e9',
          color: '#2e7d32',
          border: '1px solid #a5d6a7',
          cursor: isAdding ? 'not-allowed' : 'pointer',
          fontWeight: '400',
          flexShrink: 0,
        })}
      >
        + Add
      </button>
    </li>
  )
}

function GitCommitTab({ projectId, userId, notStagedFiles, deletedFiles = [], stagedFiles, onRefresh }) {
  var [commitMessage, setCommitMessage] = useState('')
  var [isCommitting, setIsCommitting] = useState(false)
  var [isPushing, setIsPushing] = useState(false)
  var [selected, setSelected] = useState({})
  var [addingFile, setAddingFile] = useState(null)
  var [isAddingAll, setIsAddingAll] = useState(false)
  var [notification, setNotification] = useState(null)

  var allPendingFiles = [...notStagedFiles, ...deletedFiles]
  var selectedCount = Object.values(selected).filter(Boolean).length

  function showNotif(type, message) {
    setNotification({ type: type, message: message })
  }

  function dismissNotif() {
    setNotification(null)
  }

  function toggleFile(filePath) {
    setSelected(function(prev) {
      var next = Object.assign({}, prev)
      next[filePath] = !prev[filePath]
      return next
    })
  }

  function toggleAll() {
    var allChecked = allPendingFiles.length > 0 && allPendingFiles.every(function(f) { return selected[f] })
    if (allChecked) {
      setSelected({})
    } else {
      var next = {}
      allPendingFiles.forEach(function(f) { next[f] = true })
      setSelected(next)
    }
  }

  async function handleCommit() {
    if (!commitMessage.trim()) {
      showNotif('warning', 'Le message de commit ne peut pas etre vide.')
      return
    }
    setIsCommitting(true)
    setNotification(null)
    try {
      await postJSON('/git-commit', {
        body: { projectId: projectId, userId: userId, message: commitMessage.trim() },
      })
      setCommitMessage('')
      await onRefresh()
      showNotif('success', 'Commit effectué avec succès.')
    } catch (err) {
      showNotif('error', 'Echec du commit : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsCommitting(false)
    }
  }

  async function handlePush() {
    setIsPushing(true)
    setNotification(null)
    try {
      await postJSON('/git-push', {
        body: { projectId: projectId, userId: userId },
      })
      showNotif('success', 'Push effectué avec succès.')
    } catch (err) {
      showNotif('error', 'Echec du push : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsPushing(false)
    }
  }

  async function handleAddOne(filePath) {
    setAddingFile(filePath)
    var isDeleted = deletedFiles.includes(filePath)
    try {
      await postJSON('/git-add', {
        body: { projectId: projectId, userId: userId, filePath: filePath, deleted: isDeleted },
      })
      setSelected(function(prev) {
        var next = Object.assign({}, prev)
        delete next[filePath]
        return next
      })
      await onRefresh()
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setAddingFile(null)
    }
  }

  async function handleAddSelected() {
    var files = allPendingFiles.filter(function(f) { return selected[f] })
    if (files.length === 0) return
    setAddingFile('__selected__')
    try {
      for (var i = 0; i < files.length; i++) {
        await postJSON('/git-add', {
          body: { projectId: projectId, userId: userId, filePath: files[i], deleted: deletedFiles.includes(files[i]) },
        })
      }
      setSelected({})
      await onRefresh()
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setAddingFile(null)
    }
  }

  async function handleAddAll() {
    setIsAddingAll(true)
    try {
      await postJSON('/git-add-all', {
        body: { projectId: projectId, userId: userId },
      })
      setSelected({})
      await onRefresh()
      showNotif('success', 'Tous les fichiers ont ete ajoutés au staging.')
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setIsAddingAll(false)
    }
  }

  var allChecked = allPendingFiles.length > 0 && allPendingFiles.every(function(f) { return selected[f] })
  var isStagingBusy = addingFile !== null || isAddingAll

  return (
    <div>
      {notification && (
        <GitNotif type={notification.type} message={notification.message} onDismiss={dismissNotif} />
      )}

      <div>
        <label style={{ color: 'black', fontSize: '13px', fontWeight: '500' }}>
          Message de commit
        </label>
        <textarea
          value={commitMessage}
          onChange={function(e) { setCommitMessage(e.target.value) }}
          rows="3"
          style={{
            color: 'dimgray',
            width: '100%',
            marginTop: '4px',
            boxSizing: 'border-box',
            padding: '6px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '13px',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button
          onClick={handleCommit}
          disabled={isCommitting || isPushing}
          style={Object.assign({}, BTN_GREEN, {
            flex: 1,
            opacity: (isCommitting || isPushing) ? 0.6 : 1,
            cursor: (isCommitting || isPushing) ? 'not-allowed' : 'pointer',
          })}
        >
          {isCommitting ? 'Commit...' : 'Commit'}
        </button>
        <button
          onClick={handlePush}
          disabled={isCommitting || isPushing}
          style={Object.assign({}, BTN_OUTLINE, {
            flex: 1,
            opacity: (isCommitting || isPushing) ? 0.6 : 1,
            cursor: (isCommitting || isPushing) ? 'not-allowed' : 'pointer',
          })}
        >
          {isPushing ? 'Push...' : 'Push'}
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              disabled={allPendingFiles.length === 0}
              style={{ cursor: 'pointer' }}
              title="Tout selectionner"
            />
            <h3 style={{ margin: 0, fontSize: '14px', color: 'black' }}>
              Fichiers non indexes
              {allPendingFiles.length > 0 && (
                <span style={{ color: 'gray', fontWeight: 'normal', marginLeft: '6px' }}>
                  ({allPendingFiles.length})
                </span>
              )}
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {selectedCount > 0 && (
              <button
                onClick={handleAddSelected}
                disabled={isStagingBusy}
                style={Object.assign({}, BTN_BASE, {
                  padding: '5px 10px',
                  fontSize: '12px',
                  backgroundColor: isStagingBusy ? '#ccc' : '#45a444',
                  color: 'white',
                  cursor: isStagingBusy ? 'not-allowed' : 'pointer',
                })}
              >
                Ajouter ({selectedCount})
              </button>
            )}
            <button
              onClick={handleAddAll}
              disabled={isStagingBusy || allPendingFiles.length === 0}
              style={Object.assign({}, BTN_BASE, {
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: (isStagingBusy || allPendingFiles.length === 0) ? '#ccc' : '#1976d2',
                color: 'white',
                cursor: (isStagingBusy || allPendingFiles.length === 0) ? 'not-allowed' : 'pointer',
              })}
            >
              {isAddingAll ? 'Ajout...' : 'Tout ajouter'}
            </button>
          </div>
        </div>

        {allPendingFiles.length === 0 ? (
          <p style={{ color: 'gray', fontSize: '13px', fontStyle: 'italic', margin: '8px 0' }}>
            Aucun fichier modifie.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '160px', overflowY: 'auto' }}>
            {notStagedFiles.map(function(file, index) {
              return (
                <FileRow
                  key={'m-' + index}
                  filePath={file}
                  checked={!!selected[file]}
                  onToggle={toggleFile}
                  onAddOne={handleAddOne}
                  isAdding={addingFile === file || addingFile === '__selected__'}
                />
              )
            })}
            {deletedFiles.map(function(file, index) {
              return (
                <li
                  key={'d-' + index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '5px 6px',
                    borderRadius: '4px',
                    backgroundColor: selected[file] ? '#fff5f5' : 'transparent',
                    marginBottom: '2px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[file]}
                    onChange={function() { toggleFile(file) }}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span style={{ color: '#c62828', fontWeight: 'bold', fontSize: '11px', flexShrink: 0 }}>D</span>
                  <span style={{ color: '#c62828', flex: 1, fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all', textDecoration: 'line-through' }}>
                    {file}
                  </span>
                  <button
                    onClick={function() { handleAddOne(file) }}
                    disabled={addingFile === file || addingFile === '__selected__'}
                    title="Indexer cette suppression"
                    style={Object.assign({}, BTN_BASE, {
                      padding: '3px 8px',
                      fontSize: '12px',
                      backgroundColor: (addingFile === file || addingFile === '__selected__') ? '#ccc' : '#ffebee',
                      color: '#c62828',
                      border: '1px solid #ef9a9a',
                      cursor: (addingFile === file || addingFile === '__selected__') ? 'not-allowed' : 'pointer',
                      fontWeight: '400',
                      flexShrink: 0,
                    })}
                  >
                    + Add
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '14px', color: 'black', marginBottom: '8px' }}>
          Fichiers indexes
          {stagedFiles.length > 0 && (
            <span style={{ color: 'gray', fontWeight: 'normal', marginLeft: '6px' }}>
              ({stagedFiles.length})
            </span>
          )}
        </h3>
        {stagedFiles.length === 0 ? (
          <p style={{ color: 'gray', fontSize: '13px', fontStyle: 'italic', margin: 0 }}>
            Aucun fichier indexe.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '120px', overflowY: 'auto' }}>
            {stagedFiles.map(function(file, index) {
              return (
                <li
                  key={index}
                  style={{
                    padding: '4px 6px',
                    color: '#2e7d32',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    borderLeft: '3px solid #45a444',
                    marginBottom: '2px',
                  }}
                >
                  {file}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default GitCommitTab
