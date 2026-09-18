import { useTranslation } from 'react-i18next';
import { extractError } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';

export function ErrorBanner({
  error,
  onDismiss
}: {
  error: AppErrorDtoLike | null;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  if (!error) {
    return null;
  }
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>{error.code}</strong> — {t(`errors.codes.${error.code}`, error.message)}
        {Array.isArray(error.details) && error.details.length > 0 && (
          <ul>
            {error.details.slice(0, 12).map((detail) => (
              <li key={JSON.stringify(detail) ?? String(detail)}>
                {typeof detail === 'object' && detail !== null && 'message' in detail
                  ? String(detail.message)
                  : String(detail)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button className="link" onClick={onDismiss}>
          {t('common.dismiss')}
        </button>
      )}
    </div>
  );
}

export function extractFromUnknown(error: unknown) {
  return extractError(error);
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`, status)}</span>;
}

export function Section({
  title,
  children,
  actions
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
