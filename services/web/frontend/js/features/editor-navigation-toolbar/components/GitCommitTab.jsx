import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'

var BTN_BASE = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: '500',
  fontSize: '13px',
}

var BTN_GREEN = Object.assign({}, BTN_BASE, { backgroundColor: '#45a444', color: 'white' })
var BTN_GREY = Object.assign({}, BTN_BASE, { backgroundColor: '#6c757d', color: 'white' })
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

function GitCommitTab({ projectId, userId, notStagedFiles, stagedFiles, onCommit, onPush, onRefresh }) {
  var [selected, setSelected] = useState({})
  var [addingFile, setAddingFile] = useState(null)
  var [isAddingAll, setIsAddingAll] = useState(false)
  var [feedback, setFeedback] = useState(null)

  var selectedCount = Object.values(selected).filter(Boolean).length

  function toggleFile(filePath) {
    setSelected(function(prev) {
      var next = Object.assign({}, prev)
      next[filePath] = !prev[filePath]
      return next
    })
  }

  function toggleAll() {
    var allChecked = notStagedFiles.length > 0 && notStagedFiles.every(function(f) { return selected[f] })
    if (allChecked) {
      setSelected({})
    } else {
      var next = {}
      notStagedFiles.forEach(function(f) { next[f] = true })
      setSelected(next)
    }
  }

  function showFeedback(type, message) {
    setFeedback({ type: type, message: message })
    setTimeout(function() { setFeedback(null) }, 3000)
  }

  async function handleAddOne(filePath) {
    setAddingFile(filePath)
    try {
      await postJSON('/git-add', {
        body: { projectId: projectId, userId: userId, filePath: filePath, deleted: false },
      })
      setSelected(function(prev) {
        var next = Object.assign({}, prev)
        delete next[filePath]
        return next
      })
      await onRefresh()
    } catch (err) {
      showFeedback('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setAddingFile(null)
    }
  }

  async function handleAddSelected() {
    var files = notStagedFiles.filter(function(f) { return selected[f] })
    if (files.length === 0) return
    setAddingFile('__selected__')
    try {
      for (var i = 0; i < files.length; i++) {
        await postJSON('/git-add', {
          body: { projectId: projectId, userId: userId, filePath: files[i], deleted: false },
        })
      }
      setSelected({})
      await onRefresh()
    } catch (err) {
      showFeedback('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
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
      showFeedback('success', 'Tous les fichiers ont ete ajoutes au staging.')
    } catch (err) {
      showFeedback('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setIsAddingAll(false)
    }
  }

  var allChecked = notStagedFiles.length > 0 && notStagedFiles.every(function(f) { return selected[f] })
  var isBusy = addingFile !== null || isAddingAll

  return (
    <div>
      <div>
        <label htmlFor="commit-message" style={{ color: 'black' }}>Commit message</label>
        <textarea
          id="commit-message"
          rows="3"
          style={{ color: 'dimgray', width: '100%', marginTop: '4px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button onClick={onCommit} style={Object.assign({}, BTN_GREEN, { flex: 1 })}>Commit</button>
        <button onClick={onPush} style={Object.assign({}, BTN_OUTLINE, { flex: 1 })}>Push</button>
      </div>

      {feedback && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 10px',
            borderRadius: '4px',
            fontSize: '13px',
            backgroundColor: feedback.type === 'success' ? '#d4edda' : '#f8d7da',
            color: feedback.type === 'success' ? '#155724' : '#721c24',
            border: '1px solid ' + (feedback.type === 'success' ? '#c3e6cb' : '#f5c6cb'),
          }}
        >
          {feedback.message}
        </div>
      )}

      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              disabled={notStagedFiles.length === 0}
              style={{ cursor: 'pointer' }}
              title="Tout selectionner"
            />
            <h3 style={{ margin: 0, fontSize: '14px', color: 'black' }}>
              Fichiers non indexes
              {notStagedFiles.length > 0 && (
                <span style={{ color: 'gray', fontWeight: 'normal', marginLeft: '6px' }}>
                  ({notStagedFiles.length})
                </span>
              )}
            </h3>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {selectedCount > 0 && (
              <button
                onClick={handleAddSelected}
                disabled={isBusy}
                style={Object.assign({}, BTN_BASE, {
                  padding: '5px 10px',
                  fontSize: '12px',
                  backgroundColor: isBusy ? '#ccc' : '#45a444',
                  color: 'white',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                })}
              >
                Ajouter ({selectedCount})
              </button>
            )}
            <button
              onClick={handleAddAll}
              disabled={isBusy || notStagedFiles.length === 0}
              style={Object.assign({}, BTN_BASE, {
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: (isBusy || notStagedFiles.length === 0) ? '#ccc' : '#1976d2',
                color: 'white',
                cursor: (isBusy || notStagedFiles.length === 0) ? 'not-allowed' : 'pointer',
              })}
            >
              {isAddingAll ? 'Ajout...' : 'Tout ajouter'}
            </button>
          </div>
        </div>

        {notStagedFiles.length === 0 ? (
          <p style={{ color: 'gray', fontSize: '13px', fontStyle: 'italic', margin: '8px 0' }}>
            Aucun fichier modifie.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '160px', overflowY: 'auto' }}>
            {notStagedFiles.map(function(file, index) {
              return (
                <FileRow
                  key={index}
                  filePath={file}
                  checked={!!selected[file]}
                  onToggle={toggleFile}
                  onAddOne={handleAddOne}
                  isAdding={addingFile === file || addingFile === '__selected__'}
                />
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
