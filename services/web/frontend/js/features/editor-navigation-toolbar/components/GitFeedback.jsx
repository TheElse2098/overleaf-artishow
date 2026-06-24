// Couleurs pilotées par les variables --git-* de la modale Git (dark mode).
// Le fallback garde la palette claire d'origine quand ces variables ne sont pas
// définies (ex. notif rendue hors de la modale, dans GitPullButton).
var PALETTE = {
  success: {
    bg: 'var(--git-success-bg, #d4edda)',
    border: 'var(--git-success-border, #c3e6cb)',
    text: 'var(--git-success-text, #155724)',
  },
  error: {
    bg: 'var(--git-danger-bg, #f8d7da)',
    border: 'var(--git-danger-border, #f5c6cb)',
    text: 'var(--git-danger-text, #721c24)',
  },
  warning: {
    bg: 'var(--git-warning-bg, #fff3cd)',
    border: 'var(--git-warning-border, #ffeeba)',
    text: 'var(--git-warning-text, #856404)',
  },
  info: {
    bg: 'var(--git-info-bg, #d1ecf1)',
    border: 'var(--git-info-border, #bee5eb)',
    text: 'var(--git-info-text, #0c5460)',
  },
}

export function GitNotif({ type, message, onDismiss }) {
  var c = PALETTE[type] || PALETTE.info
  return (
    <div
      style={{
        padding: '9px 12px',
        marginBottom: '12px',
        borderRadius: '4px',
        backgroundColor: c.bg,
        border: '1px solid ' + c.border,
        color: c.text,
        fontSize: '13px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: c.text,
            fontSize: '16px',
            lineHeight: 1,
            padding: '0 2px',
            opacity: 0.6,
            flexShrink: 0,
          }}
        >
          x
        </button>
      )}
    </div>
  )
}

export function GitConfirm({ message, detail, onConfirm, onCancel, confirmLabel, isDanger }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        marginTop: '12px',
        borderRadius: '5px',
        backgroundColor: 'var(--git-warning-bg, #fff8e1)',
        border: '1px solid var(--git-warning-border, #ffe082)',
      }}
    >
      <div style={{ color: 'var(--git-warning-text, #5d4037)', fontWeight: '500', marginBottom: '6px', fontSize: '13px' }}>
        {message}
      </div>
      {detail && (
        <div style={{ color: 'var(--git-warning-text, #6d4c41)', fontSize: '12px', marginBottom: '12px', lineHeight: '1.5' }}>
          {detail}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: detail ? '0' : '12px' }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '7px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: '#f8f9fa',
            color: 'black',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          Annuler
        </button>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            padding: '7px',
            border: 'none',
            borderRadius: '4px',
            backgroundColor: isDanger ? '#dc3545' : '#45a444',
            color: 'white',
            cursor: 'pointer',
            fontWeight: '500',
            fontSize: '13px',
          }}
        >
          {confirmLabel || 'Confirmer'}
        </button>
      </div>
    </div>
  )
}
