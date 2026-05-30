import { useState } from 'react'
import { postJSON } from '../../../infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import { GitNotif, GitConfirm } from '../../editor-navigation-toolbar/components/GitFeedback'

type Props = {
  projectId: string
  userId: string
}

type Notif = { type: string; message: string }

const CONFIRM_MSG =
  'Le pull va integrer les modifications du depot git distant. ' +
  'Vos commits locaux seront conserves via un merge. ' +
  'Les modifications non commitees seront sauvegardees (stash) et restaurees apres le pull.'

export default function GitPullButton({ projectId, userId }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notif, setNotif] = useState<Notif | null>(null)

  function handleClick() {
    setNotif(null)
    setShowConfirm(true)
  }

  async function handleConfirm() {
    setShowConfirm(false)
    setIsLoading(true)
    setNotif(null)
    try {
      await postJSON('/git-pull', { body: { projectId, userId } })
      setNotif({ type: 'success', message: 'Pull effectue avec succes.' })
    } catch (err: any) {
      setNotif({
        type: 'error',
        message:
          (err?.data?.errorReason) ||
          (err?.message) ||
          'Echec du pull.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn"
        onClick={handleClick}
        disabled={isLoading}
        title="Pull"
        style={{ opacity: isLoading ? 0.6 : 1 }}
      >
        <MaterialIcon type="repeat" fw accessibilityLabel="pull" />
      </button>

      {(showConfirm || notif) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            width: '320px',
            paddingTop: '4px',
          }}
        >
          {showConfirm && (
            <GitConfirm
              message="Confirmer le pull ?"
              detail={CONFIRM_MSG}
              confirmLabel="Pull"
              isDanger={false}
              onConfirm={handleConfirm}
              onCancel={() => setShowConfirm(false)}
            />
          )}
          {notif && (
            <GitNotif
              type={notif.type}
              message={notif.message}
              onDismiss={() => setNotif(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
