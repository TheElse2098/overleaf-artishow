import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import { GitNotif } from './GitFeedback'

// Signale au file tree (autre arbre React) que l'état Git des fichiers a changé,
// pour qu'il rafraîchisse les marqueurs "M". Voir git-modified-files.tsx.
function notifyGitFilesChanged() {
  window.dispatchEvent(new Event('git:files-changed'))
}

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
        backgroundColor: checked ? 'var(--git-row-checked-bg)' : 'transparent',
        marginBottom: '2px',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={function() { onToggle(filePath) }}
        style={{ cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{ color: 'var(--git-text-strong)', flex: 1, fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {filePath}
      </span>
      <button
        onClick={function() { onAddOne(filePath) }}
        disabled={isAdding}
        title="Ajouter ce fichier"
        style={Object.assign({}, BTN_BASE, {
          padding: '3px 8px',
          fontSize: '12px',
          backgroundColor: isAdding ? '#ccc' : 'var(--git-add-bg)',
          color: 'var(--git-add-text)',
          border: '1px solid var(--git-add-border)',
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

function GitCommitTab({ projectId, userId, notStagedFiles, deletedFiles = [], stagedFiles, onRefresh, mergeState = { mergeInProgress: false, conflicts: [] } }) {
  var [commitMessage, setCommitMessage] = useState('')
  var [isCommitting, setIsCommitting] = useState(false)
  var [isPushing, setIsPushing] = useState(false)
  var [selected, setSelected] = useState({})
  var [addingFile, setAddingFile] = useState(null)
  var [isAddingAll, setIsAddingAll] = useState(false)
  var [unstagingFile, setUnstagingFile] = useState(null)
  var [isUnstagingAll, setIsUnstagingAll] = useState(false)
  var [isResolving, setIsResolving] = useState(false)
  var [isAborting, setIsAborting] = useState(false)
  var [markerWarnings, setMarkerWarnings] = useState([])
  var [notification, setNotification] = useState(null)

  var mergeInProgress = mergeState && mergeState.mergeInProgress
  var conflictFiles = (mergeState && mergeState.conflicts) || []

  async function handleResolveMerge() {
    setIsResolving(true)
    setNotification(null)
    setMarkerWarnings([])
    try {
      var result = await postJSON('/git-resolve-merge', {
        body: { projectId: projectId, userId: userId, message: commitMessage.trim() || 'Merge: résolution des conflits' },
      })
      var warnings = (result && result.markerWarnings) || []
      if (warnings.length > 0) {
        // Le merge est commité, mais on signale les marqueurs encore présents.
        setMarkerWarnings(warnings)
        showNotif('warning', 'Conflit résolu et commité, mais des marqueurs de conflit subsistent dans certains fichiers (voir ci-dessous). Vérifiez s\'ils sont voulus.')
      } else {
        showNotif('success', 'Conflit résolu et commité avec succès.')
      }
      setCommitMessage('')
      await onRefresh()
      notifyGitFilesChanged()
    } catch (err) {
      showNotif('error', 'Echec de la résolution : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsResolving(false)
    }
  }

  async function handleAbortMerge() {
    setIsAborting(true)
    setNotification(null)
    setMarkerWarnings([])
    try {
      await postJSON('/git-abort-merge', {
        body: { projectId: projectId, userId: userId },
      })
      showNotif('success', 'Merge annulé. Le projet est revenu à son état d\'avant le pull.')
      await onRefresh()
      notifyGitFilesChanged()
    } catch (err) {
      showNotif('error', 'Echec de l\'annulation : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'erreur inconnue'))
    } finally {
      setIsAborting(false)
    }
  }

  const deletedFilesFiltered = deletedFiles.filter(file => !notStagedFiles.includes(file))
  var allPendingFiles = [...notStagedFiles, ...deletedFilesFiltered]
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
      notifyGitFilesChanged()
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
    var isDeleted = deletedFiles.includes(filePath) && !notStagedFiles.includes(filePath)
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
      notifyGitFilesChanged()
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
          body: { projectId: projectId, userId: userId, filePath: files[i], deleted: deletedFiles.includes(files[i]) && !notStagedFiles.includes(files[i]) },
        })
      }
      setSelected({})
      await onRefresh()
      notifyGitFilesChanged()
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setAddingFile(null)
    }
  }

  async function handleUnstage(filePath) {
    setUnstagingFile(filePath)
    try {
      await postJSON('/git-unstage', {
        body: { projectId: projectId, userId: userId, filePath: filePath },
      })
      await onRefresh()
      notifyGitFilesChanged()
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setUnstagingFile(null)
    }
  }

  async function handleUnstageAll() {
    setIsUnstagingAll(true)
    try {
      await postJSON('/git-unstage-all', {
        body: { projectId: projectId, userId: userId },
      })
      await onRefresh()
      notifyGitFilesChanged()
      showNotif('success', 'Tous les fichiers ont ete retirés du staging.')
    } catch (err) {
      showNotif('error', 'Erreur : ' + ((err && err.data && err.data.errorReason) || (err && err.message) || 'inconnu'))
    } finally {
      setIsUnstagingAll(false)
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
      notifyGitFilesChanged()
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

      {mergeInProgress && (
        <div style={{
          border: '1px solid var(--git-danger-border)',
          backgroundColor: 'var(--git-danger-row-bg)',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <strong style={{ color: 'var(--git-danger-text)', fontSize: '14px' }}>
              Conflit de merge en cours
            </strong>
          </div>
          <p style={{ color: 'var(--git-text)', fontSize: '13px', margin: '0 0 8px' }}>
            Résolvez les marqueurs de conflit (<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code>, <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>) directement dans l'éditeur, puis cliquez sur « Résoudre le conflit ». Vous pouvez aussi annuler le merge pour revenir en arrière.
          </p>
          {conflictFiles.length > 0 && (
            <ul style={{ margin: '0 0 8px', paddingLeft: '18px' }}>
              {conflictFiles.map(function(f, i) {
                return (
                  <li key={'c-' + i} style={{ color: 'var(--git-danger-text)', fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {f}
                  </li>
                )
              })}
            </ul>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={handleResolveMerge}
              disabled={isResolving || isAborting}
              style={Object.assign({}, BTN_BASE, {
                backgroundColor: (isResolving || isAborting) ? '#ccc' : '#45a444',
                color: 'white',
                cursor: (isResolving || isAborting) ? 'not-allowed' : 'pointer',
              })}
            >
              {isResolving ? 'Résolution...' : 'Résoudre le conflit'}
            </button>
            <button
              onClick={handleAbortMerge}
              disabled={isResolving || isAborting}
              style={Object.assign({}, BTN_BASE, {
                backgroundColor: 'transparent',
                color: 'var(--git-danger-text)',
                border: '1px solid var(--git-danger-border)',
                cursor: (isResolving || isAborting) ? 'not-allowed' : 'pointer',
              })}
            >
              {isAborting ? 'Annulation...' : 'Annuler le merge'}
            </button>
          </div>
        </div>
      )}

      {/* Marqueurs restants après résolution : reste visible même une fois le merge
          terminé (mergeInProgress repasse à false), pour que l'utilisateur les voie. */}
      {markerWarnings.length > 0 && (
        <div style={{
          border: '1px solid var(--git-warning-border, #ffe082)',
          backgroundColor: 'var(--git-warning-bg, #fff8e1)',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px',
        }}>
          <p style={{ color: 'var(--git-warning-text, #5d4037)', fontSize: '13px', fontWeight: 600, margin: '0 0 4px' }}>
            Marqueurs de conflit encore présents après le commit :
          </p>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {markerWarnings.map(function(w, i) {
              return (
                <li key={'w-' + i} style={{ color: 'var(--git-warning-text, #6d4c41)', fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {w.path} : lignes {(w.markers || []).map(function(m) { return m.line }).join(', ')}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <label style={{ color: 'var(--git-text-strong)', fontSize: '13px', fontWeight: '500' }}>
          Message de commit
        </label>
        <textarea
          value={commitMessage}
          onChange={function(e) { setCommitMessage(e.target.value) }}
          rows="3"
          style={{
            color: 'var(--git-text)',
            backgroundColor: 'var(--git-surface)',
            width: '100%',
            marginTop: '4px',
            boxSizing: 'border-box',
            padding: '6px',
            border: '1px solid var(--git-border)',
            borderRadius: '4px',
            fontSize: '13px',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
        <button
          onClick={handleCommit}
          disabled={isCommitting || isPushing || mergeInProgress}
          title={mergeInProgress ? 'Résolvez le conflit de merge en cours avant de commiter.' : undefined}
          style={Object.assign({}, BTN_GREEN, {
            flex: 1,
            opacity: (isCommitting || isPushing || mergeInProgress) ? 0.6 : 1,
            cursor: (isCommitting || isPushing || mergeInProgress) ? 'not-allowed' : 'pointer',
          })}
        >
          {isCommitting ? 'Commit...' : 'Commit'}
        </button>
        <button
          onClick={handlePush}
          disabled={isCommitting || isPushing || mergeInProgress}
          title={mergeInProgress ? 'Résolvez le conflit de merge en cours avant de pusher.' : undefined}
          style={Object.assign({}, BTN_OUTLINE, {
            flex: 1,
            opacity: (isCommitting || isPushing || mergeInProgress) ? 0.6 : 1,
            cursor: (isCommitting || isPushing || mergeInProgress) ? 'not-allowed' : 'pointer',
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
            <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--git-text-strong)' }}>
              Fichiers non indexes
              {allPendingFiles.length > 0 && (
                <span style={{ color: 'var(--git-text-muted)', fontWeight: 'normal', marginLeft: '6px' }}>
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
          <p style={{ color: 'var(--git-text-muted)', fontSize: '13px', fontStyle: 'italic', margin: '8px 0' }}>
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
            {deletedFilesFiltered.map(function(file, index) {
              return (
                <li
                  key={'d-' + index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '5px 6px',
                    borderRadius: '4px',
                    backgroundColor: selected[file] ? 'var(--git-danger-row-bg)' : 'transparent',
                    marginBottom: '2px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[file]}
                    onChange={function() { toggleFile(file) }}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span style={{ color: 'var(--git-danger-text)', fontWeight: 'bold', fontSize: '11px', flexShrink: 0 }}>D</span>
                  <span style={{ color: 'var(--git-danger-text)', flex: 1, fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all', textDecoration: 'line-through' }}>
                    {file}
                  </span>
                  <button
                    onClick={function() { handleAddOne(file) }}
                    disabled={addingFile === file || addingFile === '__selected__'}
                    title="Indexer cette suppression"
                    style={Object.assign({}, BTN_BASE, {
                      padding: '3px 8px',
                      fontSize: '12px',
                      backgroundColor: (addingFile === file || addingFile === '__selected__') ? '#ccc' : 'var(--git-danger-bg)',
                      color: 'var(--git-danger-text)',
                      border: '1px solid var(--git-danger-border)',
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--git-text-strong)' }}>
            Fichiers indexes
            {stagedFiles.length > 0 && (
              <span style={{ color: 'var(--git-text-muted)', fontWeight: 'normal', marginLeft: '6px' }}>
                ({stagedFiles.length})
              </span>
            )}
          </h3>
          {stagedFiles.length > 0 && (
            <button
              onClick={handleUnstageAll}
              disabled={unstagingFile !== null || isUnstagingAll}
              style={Object.assign({}, BTN_BASE, {
                padding: '5px 10px',
                fontSize: '12px',
                backgroundColor: (unstagingFile !== null || isUnstagingAll) ? '#ccc' : 'var(--git-danger-bg)',
                color: 'var(--git-danger-text)',
                border: '1px solid var(--git-danger-border)',
                cursor: (unstagingFile !== null || isUnstagingAll) ? 'not-allowed' : 'pointer',
              })}
            >
              {isUnstagingAll ? 'Retrait...' : 'Tout désindexer'}
            </button>
          )}
        </div>
        {stagedFiles.length === 0 ? (
          <p style={{ color: 'var(--git-text-muted)', fontSize: '13px', fontStyle: 'italic', margin: 0 }}>
            Aucun fichier indexe.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '120px', overflowY: 'auto' }}>
            {stagedFiles.map(function(file, index) {
              return (
                <li
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 6px',
                    borderLeft: '3px solid var(--git-accent)',
                    marginBottom: '2px',
                  }}
                >
                  <span style={{ flex: 1, color: 'var(--git-add-text-strong)', fontSize: '13px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {file}
                  </span>
                  <button
                    onClick={function() { handleUnstage(file) }}
                    disabled={unstagingFile === file || isUnstagingAll}
                    title="Retirer ce fichier du staging"
                    style={Object.assign({}, BTN_BASE, {
                      padding: '3px 8px',
                      fontSize: '12px',
                      backgroundColor: (unstagingFile === file || isUnstagingAll) ? '#ccc' : 'var(--git-danger-bg)',
                      color: 'var(--git-danger-text)',
                      border: '1px solid var(--git-danger-border)',
                      cursor: (unstagingFile === file || isUnstagingAll) ? 'not-allowed' : 'pointer',
                      fontWeight: '400',
                      flexShrink: 0,
                    })}
                  >
                    – Unstage
                  </button>
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
