export function ConfirmDialog({ open, title, description, confirmLabel, destructive = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="confirm-title">{title}</h2>
      <p>{description}</p>
      <div className="dialog-actions"><button className="secondary-button" onClick={onCancel}>取消</button><button className={`primary-button ${destructive ? "danger-button" : ""}`} onClick={onConfirm}>{confirmLabel}<span>→</span></button></div>
    </section>
  </div>;
}
