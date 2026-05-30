import PropTypes from 'prop-types'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'
import MaterialIcon from '../../../shared/components/material-icon'
import './Modal.css'

import useAsync from '../../../shared/hooks/use-async'
import {
  getJSON,
  postJSON,
} from '../../../infrastructure/fetch-json'
import GitTokenTab from './GitTokenTab'

function Modal({
  isOpen,
  onClose,
  onCommit,
  onPush,
  onRollback,
  notStagedFiles,
  stagedFiles,
  commitHistory,
  isRollbackLoading,
  branches,
  selectedBranch,
  onSelectBranch,
  onCreateBranch,
  projectId,
  userId,
}) {
  const [activeTab, setActiveTab] = useState('commit')
  const [selectedCommit, setSelectedCommit] = useState('')
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])


  if (!isOpen) return null

  return (
    <div className="modal-overlay">

        <div className="modal-content">
          <button onClick={onClose} className="modal-close-button">X</button>
          <h2 style={{ fontFamily: 'sans-serif', fontWeight: 500 }}>Git Menu</h2>
          
          {/* Tabs */}
          <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid #ddd' }}>
            <button 
              onClick={() => setActiveTab('commit')}
              style={{ 
                padding: '10px 20px', 
                border: 'none', 
                backgroundColor: activeTab === 'commit' ? '#45a444' : 'transparent',
                color: activeTab === 'commit' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Commit & Push
            </button>
            <button 
              onClick={() => setActiveTab('rollback')}
              style={{ 
                padding: '10px 20px', 
                border: 'none', 
                backgroundColor: activeTab === 'rollback' ? '#45a444' : 'transparent',
                color: activeTab === 'rollback' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Rollback
            </button>
            <button 
              onClick={() => setActiveTab('branches')}
              style={{ 
                padding: '10px 20px', 
                border: 'none', 
                backgroundColor: activeTab === 'branches' ? '#45a444' : 'transparent',
                color: activeTab === 'branches' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Branches
            </button>
            <button
              onClick={() => setActiveTab('documentation')}
              style={{
                padding: '10px 20px',
                border: 'none',
                backgroundColor: activeTab === 'documentation' ? '#45a444' : 'transparent',
                color: activeTab === 'documentation' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Documentation
            </button>
            <button
              onClick={() => setActiveTab('token')}
              style={{
                padding: '10px 20px',
                border: 'none',
                backgroundColor: activeTab === 'token' ? '#45a444' : 'transparent',
                color: activeTab === 'token' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Token
            </button>
          </div>

          {/* Commit & Push Tab */}
          {activeTab === 'commit' && (
            <>
              <div>
                <label htmlFor="commit-message" style={{ color: 'black' }}>Commit message</label>
                <textarea id="commit-message" rows="4" style={{ color: 'dimgray', width: '100%' }}></textarea>
              </div>
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button onClick={onCommit} style={{ color: 'black', width: '100%', marginBottom: '10px' }}>Commit</button>
                <button onClick={onPush} style={{ color: 'black', width: '100%' }}>Push</button>
              </div>
              <div style={{ marginTop: '20px' }}>
                <h3>Modified files (not staged)</h3>
                <ul>
                  {notStagedFiles.map((file, index) => (
                    <li key={index} style={{ color: 'black' }}>{file}</li>
                  ))}
                </ul>
              </div>
              <div style={{ marginTop: '20px' }}>
                <h3>Staged files</h3>
                <ul>
                  {stagedFiles.map((file, index) => (
                    <li key={index} style={{ color: 'black' }}>{file}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Rollback Tab */}
          {activeTab === 'rollback' && (
            <>
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'black', marginBottom: '10px' }}>Recent Commits</h3>
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px' }}>
                  {commitHistory.length > 0 ? (
                    commitHistory.map((commit, index) => (
                      <div 
                        key={commit.hash} 
                        style={{ 
                          marginBottom: '10px', 
                          padding: '10px', 
                          border: selectedCommit === commit.hash ? '2px solid #007bff' : '1px solid #eee',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          backgroundColor: selectedCommit === commit.hash ? '#f0f8ff' : 'white'
                        }}
                        onClick={() => setSelectedCommit(commit.hash)}
                      >
                        <div style={{ fontWeight: 'bold', color: '#007bff', fontSize: '12px', fontFamily: 'monospace' }}>
                          {commit.hash.substring(0, 7)}
                        </div>
                        <div style={{ color: 'black', marginTop: '5px', fontWeight: '500' }}>
                          {commit.message || 'No commit message'}
                        </div>
                        {commit.author && (
                          <div style={{ color: 'gray', fontSize: '11px', marginTop: '3px' }}>
                            by {commit.author}
                          </div>
                        )}
                        {commit.date && (
                          <div style={{ color: 'gray', fontSize: '11px', marginTop: '3px' }}>
                            {new Date(commit.date).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'gray', textAlign: 'center', padding: '20px' }}>
                      No commit history available
                    </div>
                  )}
                </div>
              </div>
              
              {selectedCommit && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ 
                    padding: '10px', 
                    backgroundColor: '#fff3cd', 
                    border: '1px solid #ffeaa7', 
                    borderRadius: '5px',
                    marginBottom: '15px'
                  }}>
                    <strong style={{ color: '#856404' }}>⚠️ Warning:</strong>
                    <div style={{ color: '#856404', marginTop: '5px' }}>
                      Rolling back will reset your project to commit <code>{selectedCommit.substring(0, 7)}</code>. 
                      All changes after this commit will be lost permanently.
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => onRollback(selectedCommit)}
                    disabled={isRollbackLoading}
                    style={{ 
                      backgroundColor: isRollbackLoading ? '#6c757d' : '#dc3545', 
                      color: 'white', 
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '5px',
                      cursor: isRollbackLoading ? 'not-allowed' : 'pointer',
                      width: '100%'
                    }}
                  >
                    {isRollbackLoading ? 'Rolling back...' : 'Rollback to this commit'}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Branches Tab */}
          {activeTab === 'branches' && (
            <>
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'black', marginBottom: '10px' }}>Current Branch: {selectedBranch}</h3>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="new-branch" style={{ color: 'black' }}>Create New Branch</label>
                <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
                  <input
                    id="new-branch"
                    type="text"
                    placeholder="new-branch-name"
                    style={{ flex: 1, padding: '5px', color: 'dimgray' }}
                  />
                  <button onClick={onCreateBranch} style={{ padding: '5px 10px', color: 'black' }}>
                    Create & Checkout
                  </button>
                </div>
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="branch-select" style={{ color: 'black' }}>Switch to Branch</label>
                <select
                  id="branch-select"
                  value={selectedBranch}
                  onChange={(e) => onSelectBranch(e.target.value)}
                  style={{ width: '100%', padding: '5px', color: 'dimgray', marginTop: '5px' }}
                  disabled={branches.length === 0}
                >
                  {branches.length === 0 ? (
                    <option>Loading branches...</option>
                  ) : (
                    branches.map((branch, idx) => (
                      <option key={idx} value={branch}>{branch}</option>
                    ))
                  )}
                </select>
              </div>

              <div style={{ marginTop: '20px' }}>
                <h4 style={{ color: 'black', marginBottom: '10px' }}>Available Branches</h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px' }}>
                  {branches.length > 0 ? (
                    branches.map((branch, index) => (
                      <div 
                        key={index}
                        style={{ 
                          padding: '8px', 
                          marginBottom: '5px',
                          backgroundColor: branch === selectedBranch ? '#e3f2fd' : '#f8f9fa',
                          border: branch === selectedBranch ? '1px solid #2196f3' : '1px solid #dee2e6',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                        onClick={() => onSelectBranch(branch)}
                      >
                        <span style={{ color: 'black', fontWeight: branch === selectedBranch ? 'bold' : 'normal' }}>
                          {branch} {branch === selectedBranch && '(current)'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'gray', textAlign: 'center', padding: '20px' }}>
                      No branches available
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {/* Token Tab */}
          {activeTab === 'token' && (
            <GitTokenTab projectId={projectId} userId={userId} />
          )}

          {/* Documentation Tab */}
          {activeTab === 'documentation' && (
            <div style={{ color: 'black', fontFamily: 'sans-serif', lineHeight: '1.6' }}>
              <h3>Guide d'utilisation de Git</h3>

              <p><strong>Avant toute opération Git</strong><br />
              Assurez-vous que le projet compile <strong>sans erreur</strong>.</p>

              <h4>a. <code>git add</code> – Ajouter les fichiers</h4>
              <ul>
                <li>Regardez la colonne de gauche où se trouvent vos fichiers</li>
                <li>Cliquez sur les <strong>trois points</strong> à droite du nom du fichier choisi</li>
                <li>Sélectionnez <strong>"Add"</strong></li>
              </ul>

              <h4>b. <code>git commit</code> et <code>git push</code> – Valider et envoyer les changements</h4>
              <ul>
                <li>Ouvrez le <strong>menu Git</strong> situé à droite de l’écran</li>
                <li>Écrivez votre message de commit dans le champ prévu</li>
                <li>Cliquez sur <strong>"Commit"</strong></li>
                <li>Cliquez ensuite sur <strong>"Push"</strong> pour envoyer vos commits vers le dépôt distant</li>
              </ul>

              <h4>c. <code>git pull</code> – Récupérer les changements du dépôt distant</h4>
              <ul>
                <li>Cliquez sur le bouton <strong>"Pull"</strong> en haut à gauche (icône en forme de flèche circulaire)</li>
                <li> ⚠️  Il semble y avoir un bug qui ajoute les fichiers générés par la compil quand on clique sur pull, donc il faut faire un Rollback au commit pullé après un pull (cf section suivante) - Attention à la perte de donnée non encore committée le cas échéant. Cet ajout fait échouer la compilation donc il faut cliquer sur <strong>"Clear cached files"</strong> sur la page (en rouge) après le rollback.</li>
              </ul>

              <h4>d. <code>git rollback</code> – Revenir à un ancien commit</h4>
              <ul>
                <li>Cliquez sur le <strong>Git Menu</strong> (en haut à droite)</li>
                <li>Allez dans l’onglet <strong>"Rollback"</strong></li>
                <li>Sélectionnez un commit, puis cliquez sur <strong>"Rollback to this commit"</strong></li>
              </ul>
              <p style={{ color: 'red' }}><strong>⚠️ Cette action supprimera toutes les modifications après ce commit.</strong></p>

              <h4>e. <code>git branch</code> – Voir et changer de branche</h4>
              <ul>
                <li>Votre branche actuelle est affichée dans <strong>"Select Branch"</strong></li>
                <li>Toutes les branches distantes sont visibles</li>
                <li>Pour changer de branche, utilisez le menu <strong>"Select Branch"</strong></li>
                <li>Pour créer une nouvelle branche :
                  <ul>
                    <li>Entrez le <strong>nom souhaité</strong></li>
                    <li>Cliquez sur <strong>"Create New Branch"</strong></li>
                    <li>La branche sera automatiquement créée, sélectionnée (<em>checkout</em>) et envoyée (<em>push</em>) vers le dépôt Git distant</li>
                  </ul>
                </li>
              </ul>

              <div style={{ marginTop: '10px', fontStyle: 'italic', color: 'gray' }}>
                Remarque : certaines opérations (comme "add") peuvent être automatisées selon la configuration serveur.
              </div>
            </div>
          )}
      </div>
    </div>
  )
}

function GitToggleButton() {

  const { id: userId } = useUserContext()
  const { projectId } = useProjectContext()
  const { isLoading, isSuccess, isError, error, runAsync } = useAsync()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [notStagedFiles, setNotStagedFiles] = useState([])
  const [stagedFiles, setStagedFiles] = useState([])
  const [commitHistory, setCommitHistory] = useState([])
  const [isRollbackLoading, setIsRollbackLoading] = useState(false)
  const [branches, setBranches] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('')

  const classes = classNames(
    'btn',
    'btn-full-height',
    'btn-full-height-no-border'
  )

  useEffect(() => {
    if (isModalOpen) {
      loadGitData()
    }
  }, [isModalOpen]);

  const loadGitData = async () => {
    try {
      const [notStaged, staged, commits, branchesData, currentBranch] = await Promise.all([
        getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`),
        getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`),
        getJSON(`/git-commits?projectId=${projectId}&userId=${userId}&limit=20`),
        getJSON(`/git-branches?projectId=${projectId}&userId=${userId}`),
        getJSON(`/git-currentbranch?projectId=${projectId}&userId=${userId}`)
      ])
      
      setNotStagedFiles(notStaged)
      setStagedFiles(staged)
      setCommitHistory(commits)
      setBranches(branchesData)
      setSelectedBranch(currentBranch)
    } catch (error) {
      console.error('Error loading git data:', error)
    }
  }

  const handleButtonClick = (event) => {
    event.stopPropagation()
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleCommit = () => {
    const commitMessageInput = document.getElementById('commit-message')
    const message = commitMessageInput.value
    
    if (!message.trim()) {
      alert('Please enter a commit message')
      return
    }
    
    runAsync(
      postJSON('/git-commit', {
        body:{
          projectId: projectId,
          userId: userId,
          message: message
        }
      })
    ).then(() => {
      // Recharger les données après le commit
      loadGitData()
      alert("Commit successful");
    }).catch(error => {
      alert(error.data.errorReason);
    })
    
    // Vider le champ de message
    commitMessageInput.value = ''
  }

  const handlePush = () => {
    runAsync(
      postJSON('/git-push', {
        body:{
          projectId: projectId,
          userId: userId
        }
      })
      .then(response => {
        alert("Push successful");
      })
      .catch( error => {
        alert(error.data.errorReason);
      })
    )
  }

  const handleRollback = async (commitHash) => {
    if (!commitHash) {
      alert('Please select a commit to rollback to')
      return
    }

    const confirmed = window.confirm(
      `Are you sure you want to rollback to commit ${commitHash.substring(0, 7)}? This action cannot be undone and will permanently lose all changes after this commit.`
    )

    if (confirmed) {
      setIsRollbackLoading(true)
      
      try {
        const response = await postJSON('/git-rollback', {
          body: {
            projectId: projectId,
            userId: userId,
            commitHash: commitHash
          }
        })
        
        if (response.success) {
          alert(`Successfully rolled back to commit ${commitHash.substring(0, 7)}. Please refresh the page to see the changes.`)
          // Fermer la modal et rafraîchir la page
          setIsModalOpen(false)
          window.location.reload()
        } else {
          throw new Error(response.error || 'Rollback failed')
        }
      } catch (error) {
        alert('Rollback failed: ' + (error.data?.errorReason || error.message))
      } finally {
        setIsRollbackLoading(false)
      }
    }
  }

  const handleSelectBranch = async (branchName) => {
    if (branchName === selectedBranch) return // Pas besoin de changer si c'est déjà la branche courante
    
    setSelectedBranch(branchName);  // optimistic UI update

    try {
      await runAsync(
        postJSON('/git-switch-branch', {
          body: { projectId, userId, branchName }
        })
      );

      // Recharger toutes les données après le changement de branche
      await loadGitData()
      
      alert(`Switched to branch: ${branchName}`)

    } catch (error) {
      // Restaurer la branche précédente en cas d'erreur
      await loadGitData()
      alert('Failed to switch branch: ' + (error.data?.errorReason || error.message));
    }
  }

  const handleCreateBranch = async () => {
    const input = document.getElementById('new-branch');
    const branchName = input?.value.trim();

    if (!branchName) {
      alert('Branch name cannot be empty');
      return;
    }

    try {
      await postJSON('/git-create-branch', {
        body: {
          projectId,
          userId,
          newBranchName: branchName,
        },
      });

      alert(`Branch '${branchName}' created and checked out successfully`);
      input.value = '';

      // Recharger toutes les données après création de branche
      await loadGitData()

    } catch (err) {
      alert('Failed to create branch: ' + (err?.data?.errorReason || err.message));
    }
  };

  return (
    <div className="toolbar-item">
      <button className={classes} onClick={handleButtonClick}>
        <MaterialIcon type="comment" fw className={''} />
        <p className="toolbar-label">{'Git menu'}</p>
      </button>
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onCommit={handleCommit}
        onPush={handlePush}
        onRollback={handleRollback}
        notStagedFiles={notStagedFiles}
        stagedFiles={stagedFiles}
        commitHistory={commitHistory}
        isRollbackLoading={isRollbackLoading}
        branches={branches}
        selectedBranch={selectedBranch}
        onSelectBranch={handleSelectBranch}
        onCreateBranch={handleCreateBranch}
        projectId={projectId}
        userId={userId}
      />
    </div>
  )
}

export default GitToggleButton
