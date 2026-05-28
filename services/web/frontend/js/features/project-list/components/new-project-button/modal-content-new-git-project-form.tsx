import React, { useState } from 'react'
import { Alert, Button, Form, FormControl, Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../../infrastructure/fetch-json'
import { useRefWithAutoFocus } from '../../../../shared/hooks/use-ref-with-auto-focus'
import { useLocation } from '../../../../shared/hooks/use-location'
import getMeta from '@/utils/meta'
import Notification from '@/shared/components/notification'

type NewProjectData = {
  project_id: string
  owner_ref: string
  owner: {
    first_name: string
    last_name: string
    email: string
    id: string
  }
}

type Props = {
  onCancel: () => void
  template?: string
}

const TOKEN_TYPES = [
  { value: 'github', label: 'GitHub (Personal Access Token)' },
  { value: 'gitlab', label: 'GitLab (Personal Access Token / OAuth2)' },
]

function ModalContentNewGithubProjectForm({ onCancel, template = 'none' }: Props) {
  const { t } = useTranslation()
  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()
  const [projectName, setProjectName] = useState('')
  const [token, setToken] = useState('')
  const [tokenType, setTokenType] = useState('github')
  const [showToken, setShowToken] = useState(false)
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()
  const location = useLocation()
  const newNotificationStyle = getMeta(
    'ol-newNotificationStyle',
    false
  ) as boolean

  const createNewProject = () => {
    runAsync(
      postJSON('/project/new', {
        body: {
          _csrf: window.csrfToken,
          projectName,
          template,
          ...(token.trim() ? { token: token.trim(), tokenType } : {}),
        },
      })
    )
      .then(data => {
        if (data.project_id) {
          location.assign(`/project/${data.project_id}`)
        }
      })
      .catch(() => {})
  }

  const handleChangeName = (
    e: React.ChangeEvent<HTMLInputElement & FormControl>
  ) => {
    setProjectName(e.currentTarget.value)
  }

  const handleSubmit = (e: React.FormEvent<Form>) => {
    e.preventDefault()
    createNewProject()
  }

  return (
    <>
      <Modal.Header closeButton>
        <Modal.Title>{'Import project'}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {isError &&
          (newNotificationStyle ? (
            <div className="notification-list">
              <Notification
                type="error"
                content={getUserFacingMessage(error) as string}
              />
            </div>
          ) : (
            <Alert bsStyle="danger">{getUserFacingMessage(error)}</Alert>
          ))}
        
        {/* Explication SSH GitHub en vert */}
        <Alert bsStyle="success" style={{ marginBottom: '15px' }}>
          <strong>Comment trouver le lien SSH de votre dépôt GitHub :</strong>
          <ol style={{ marginTop: '10px', marginBottom: '10px' }}>
            <li>Rendez-vous sur la page de votre dépôt GitHub</li>
            <li>Cliquez sur le bouton vert <strong>"Code"</strong></li>
            <li>Sélectionnez l'onglet <strong>"SSH"</strong></li>
            <li>Copiez l'URL qui commence par <code>git@github.com:</code></li>
          </ol>
          <small>
            <strong>Note :</strong> Vous devez avoir ajouté la clé SSH de <a href="/user/settings" target="blank">votre compte overleaf</a> sur votre compte GitHub pour utiliser cette méthode.{' '}
            <a 
              href="https://docs.github.com/fr/authentication/connecting-to-github-with-ssh" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              En savoir plus
            </a>
          </small>
        </Alert>

        <Form onSubmit={handleSubmit}>
          <input
            type="text"
            className="form-control"
            ref={autoFocusedRef}
            placeholder={'git@example.com:author/project.git'}
            onChange={handleChangeName}
            value={projectName}
          />

          {/* Champs token optionnels */}
          <hr style={{ margin: '18px 0 14px' }} />
          <p style={{ fontWeight: 500, marginBottom: '10px' }}>
            Authentification par token <span style={{ fontWeight: 400, color: 'gray', fontSize: '13px' }}>(optionnel — laissez vide pour utiliser SSH)</span>
          </p>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
              Type de token
            </label>
            <select
              className="form-control"
              value={tokenType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTokenType(e.target.value)}
            >
              {TOKEN_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '4px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
              Token d'accès personnel
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type={showToken ? 'text' : 'password'}
                className="form-control"
                placeholder={'ghp_xxxxxxxxxxxxxxxxxxxx'}
                value={token}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowToken(v => !v)}
                style={{ whiteSpace: 'nowrap' }}
              >
                {showToken ? 'Masquer' : 'Voir'}
              </button>
            </div>
          </div>
        </Form>
      </Modal.Body>

      <Modal.Footer>
        <Button bsStyle={null} className="btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          bsStyle="primary"
          onClick={createNewProject}
          disabled={projectName === '' || isLoading}
        >
          {isLoading ? `${'Importing'}…` : 'Import'}
        </Button>
      </Modal.Footer>
    </>
  )
}

export default ModalContentNewGithubProjectForm
