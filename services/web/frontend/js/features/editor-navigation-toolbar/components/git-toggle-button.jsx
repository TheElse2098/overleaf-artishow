import PropTypes from 'prop-types'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import MaterialIcon from '../../../shared/components/material-icon'
import './Modal.css'

import useAsync from '../../../shared/hooks/use-async'
import {
  getJSON,
  postJSON,
} from '../../../infrastructure/fetch-json'
import GitTokenTab from './GitTokenTab'
import GitCommitTab from './GitCommitTab'
import GitRollbackTab from './GitRollbackTab'
import GitBranchesTab from './GitBranchesTab'
import GitRemotesTab from './GitRemotesTab'

function Modal({
  isOpen,
  onClose,
  notStagedFiles,
  deletedFiles,
  stagedFiles,
  commitHistory,
  branches,
  selectedBranch,
  projectId,
  userId,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState('commit')
  const activeOverallTheme = useActiveOverallTheme()
  const isDark = activeOverallTheme === 'dark'

  const TABS = [
    { id: 'commit', label: 'Commit & Push' },
    { id: 'rollback', label: 'Rollback' },
    { id: 'branches', label: 'Branches' },
    { id: 'remotes', label: 'Remotes' },
    { id: 'token', label: 'Token' },
    { id: 'documentation', label: 'Documentation' },
  ]

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

        <div className={'modal-content' + (isDark ? ' git-menu-dark' : '')}>
          <button onClick={onClose} className="modal-close-button">X</button>
          <h2 style={{ fontFamily: 'sans-serif', fontWeight: 500 }}>Git Menu</h2>

          {/* Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginBottom: '20px', borderBottom: '1px solid var(--git-border)' }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '10px 14px',
                    border: 'none',
                    borderRadius: '4px 4px 0 0',
                    whiteSpace: 'nowrap',
                    backgroundColor: isActive ? 'var(--git-accent)' : 'transparent',
                    color: isActive ? 'white' : 'var(--git-text)',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Commit & Push Tab */}
          {activeTab === 'commit' && (
            <GitCommitTab
              projectId={projectId}
              userId={userId}
              notStagedFiles={notStagedFiles}
              deletedFiles={deletedFiles}
              stagedFiles={stagedFiles}
              onRefresh={onRefresh}
            />
          )}

          {/* Rollback Tab */}
          {activeTab === 'rollback' && (
            <GitRollbackTab
              projectId={projectId}
              userId={userId}
              commitHistory={commitHistory}
              onClose={onClose}
            />
          )}

          {/* Branches Tab */}
          {activeTab === 'branches' && (
            <GitBranchesTab
              projectId={projectId}
              userId={userId}
              branches={branches}
              selectedBranch={selectedBranch}
              onRefresh={onRefresh}
            />
          )}
          {/* Remotes Tab */}
          {activeTab === 'remotes' && (
            <GitRemotesTab
              projectId={projectId}
              userId={userId}
              onRefresh={onRefresh}
            />
          )}

          {/* Token Tab */}
          {activeTab === 'token' && (
            <GitTokenTab projectId={projectId} userId={userId} />
          )}

          {/* Documentation Tab */}
          {activeTab === 'documentation' && (
            <div style={{ color: 'black', fontFamily: 'sans-serif', lineHeight: '1.6' }}>
              <h2>Guide d'utilisation de Git</h2>

              <h3>Importer un projet depuis un dépôt git distant</h3>

              <ul>Cliquez sur le bouton <strong>New Project</strong> puis <strong>Import from Git</strong></ul>
              <ul>Copier-coller le lien ssh (git@github.com:&gt;votre pseudo&lt;/&gt;votre repo &lt;)</ul>
              <ul>Entrez votre token git. Si vous souhaitez utiliser une connexion par ssh, autoriser la clé que vous trouverez dans les paramètres de votre compte overleaf</ul>
              <ul>Enfin, cliquez sur <strong>Importer</strong></ul>

              <h3>Les commandes Git usuelles</h3>

              <p><strong>Avant toute opération Git</strong><br />
              Assurez-vous que le projet compile <strong>sans erreur</strong>.</p>

              <h4>a. <code>git add</code> – Ajouter les fichiers</h4>
              <ul>
                <h5>Première option</h5>
                <li>Compiler le projet</li>
                <li>Ouvrez le menu git et ajoutez vos fichiers aux fichiers staged</li>
                <h5>Deuxième option</h5>
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
              </ul>
              <p>Vos modifications non comitées seront stash avant le pull puis pop après. <strong>Dans le cas de conflit sur un fichier, vos modifications non commitées sur ce fichier seront supprimées.</strong></p>

              <h4>d. <code>git rollback</code> – Revenir à un ancien commit</h4>
              <ul>
                <li>Cliquez sur le <strong>Git Menu</strong> (en haut à droite)</li>
                <li>Allez dans l’onglet <strong>"Rollback"</strong></li>
                <li>Sélectionnez un commit, puis cliquez sur <strong>"Rollback to this commit"</strong></li>
              </ul>
              <p style={{ color: '#e0524d' }}><strong>⚠️ Cette action supprimera toutes les modifications après ce commit.</strong></p>

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
              <p><strong>Vos modifications non commitées seront supprimées.</strong></p>


              <div style={{ marginTop: '10px', fontStyle: 'italic', color: 'var(--git-text-muted)' }}>
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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [notStagedFiles, setNotStagedFiles] = useState([])
  const [deletedFiles, setDeletedFiles] = useState([])
  const [stagedFiles, setStagedFiles] = useState([])
  const [commitHistory, setCommitHistory] = useState([])
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
      
      setNotStagedFiles(notStaged.notStaged || [])
      setDeletedFiles(notStaged.deleted || [])
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

  return (
    <div className="toolbar-item">
      <button className={classes} onClick={handleButtonClick} style={{ color: 'var(--toolbar-btn-color)' }}>
        <MaterialIcon type="comment" fw className={''} />
        <p className="toolbar-label">{'Git menu'}</p>
      </button>
      {createPortal(
        <Modal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          notStagedFiles={notStagedFiles}
          deletedFiles={deletedFiles}
          stagedFiles={stagedFiles}
          commitHistory={commitHistory}
          branches={branches}
          selectedBranch={selectedBranch}
          projectId={projectId}
          userId={userId}
          onRefresh={loadGitData}
        />,
        document.body
      )}
    </div>
  )
}

export default GitToggleButton
