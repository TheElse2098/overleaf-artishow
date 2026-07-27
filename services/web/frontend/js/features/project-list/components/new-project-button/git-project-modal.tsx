import { Modal } from 'react-bootstrap'

import ModalContentNewProjectForm from './modal-content-new-git-project-form'

type GitProjectModalProps = {
  onHide: () => void
}

function GitProjectModal({ onHide }: GitProjectModalProps) {
  return (
    <Modal
      show
      animation
      onHide={onHide}
      id="git-project-modal"
      backdrop="static"
    >
      <ModalContentNewProjectForm onCancel={onHide} template="git"/>
    </Modal>
  )
}

export default GitProjectModal
