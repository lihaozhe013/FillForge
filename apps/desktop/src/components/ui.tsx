import { extractError } from "../hooks/useAsyncData";

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: { code: string; message: string } | null;
  onDismiss?: () => void;
}) {
  if (!error) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>{error.code}</strong> — {error.message}
      </div>
      {onDismiss && (
        <button className="link" onClick={onDismiss}>
          dismiss
        </button>
      )}
    </div>
  );
}

export function extractFromUnknown(error: unknown) {
  return extractError(error);
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="empty-hint">{children}</p>;
}
