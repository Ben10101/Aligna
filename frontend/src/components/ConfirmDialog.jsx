export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  intent = 'danger',
  loading = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null

  const intentStyles = {
    danger: 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-200',
    warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-200',
    primary: 'bg-[#102a72] hover:bg-[#0c205a] focus:ring-blue-200',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">Confirmar ação</p>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
          <p className="text-sm leading-7 text-slate-600">{description}</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="dashboard-button-secondary w-full sm:w-auto" disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`dashboard-button-primary w-full sm:w-auto focus:outline-none focus:ring-4 ${intentStyles[intent] || intentStyles.danger}`}
            disabled={loading}
          >
            {loading ? 'Processando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
