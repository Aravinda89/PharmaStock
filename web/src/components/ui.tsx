import type { ReactNode } from 'react';
import { expiryChip, stockChip } from '../lib/format';
import type { ExpiryStatus, StockStatus } from '../lib/types';

/**
 * Status is always colour + icon + words. A pharmacist scanning quickly reads
 * the colour; anyone printing in black and white, or with a colour vision
 * difference, still gets the meaning.
 */
export function Chip({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'grey' | 'blue'; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function ExpiryChip({ status, days }: { status: ExpiryStatus; days?: number }) {
  const { tone, icon, label } = expiryChip(status, days);
  return (
    <Chip tone={tone}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </Chip>
  );
}

export function StockChip({ status }: { status: StockStatus }) {
  const { tone, icon, label } = stockChip(status);
  return (
    <Chip tone={tone}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </Chip>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  tight = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="count">{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      <div className={`card-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'red' | 'amber' | 'green';
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`kpi tone-${tone}${onClick ? ' clickable' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </Tag>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  message,
  ok = false,
  action,
}: {
  icon?: string;
  title: string;
  message?: string;
  ok?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`empty${ok ? ' ok' : ''}`}>
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <div className="empty-title">{title}</div>
      {message && <div>{message}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> <span style={{ marginLeft: 8 }}>{label}</span>
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="banner red">
      <span aria-hidden="true">⚠️</span>
      <div className="banner-body">
        <strong>That did not work</strong>
        {message}
      </div>
      {onRetry && (
        <button className="btn small" onClick={onRetry} type="button">
          Try again
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: 'red' | 'amber' | 'green' | 'blue';
  icon?: string;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <div className="banner-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className={`modal${wide ? ' wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-head">
          <h2>{title}</h2>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Anything that moves stock or deletes a record confirms first, and the
 * message spells out the consequence rather than asking "are you sure?".
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy} type="button">
            Cancel
          </button>
          <button className={`btn ${tone}`} onClick={onConfirm} disabled={busy} type="button">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {message}
      {children}
    </Modal>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
