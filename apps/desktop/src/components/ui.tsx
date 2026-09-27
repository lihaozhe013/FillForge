import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { extractError } from '../hooks/useAsyncData';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function translateErrorDetail(t: TFunction, detail: unknown): string {
  if (!isRecord(detail)) return String(detail);

  const message = typeof detail.message === 'string' ? detail.message : JSON.stringify(detail);
  const args = isRecord(detail.messageArgs) ? detail.messageArgs : {};
  const field = typeof detail.field === 'string' ? { field: detail.field } : {};
  const localizedArgs: Record<string, unknown> = { ...args, ...field };
  if (typeof localizedArgs.status === 'string') {
    localizedArgs.status = t(`status.${localizedArgs.status}`, {
      defaultValue: localizedArgs.status
    });
  }
  if (typeof localizedArgs.expected === 'string') {
    localizedArgs.expected = t(`editor.typeNames.${localizedArgs.expected}`, {
      defaultValue: localizedArgs.expected
    });
  }
  const messageKey =
    typeof detail.messageKey === 'string'
      ? `errors.${detail.messageKey}`
      : typeof detail.code === 'string'
        ? `errors.issues.${detail.code}`
        : undefined;

  return messageKey ? t(messageKey, { ...localizedArgs, defaultValue: message }) : message;
}

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
  const translatedMessage = t(`errors.codes.${error.code}`, { defaultValue: error.message });
  return (
    <div className="error-banner" role="alert">
      <div>
        {translatedMessage}
        {error.code === 'internal_error' && error.message !== translatedMessage && (
          <p>{error.message}</p>
        )}
        {Array.isArray(error.details) && error.details.length > 0 && (
          <ul>
            {error.details.slice(0, 12).map((detail) => (
              <li key={JSON.stringify(detail) ?? String(detail)}>
                {translateErrorDetail(t, detail)}
              </li>
            ))}
          </ul>
        )}
        {isRecord(error.details) && 'messageKey' in error.details && (
          <p>{translateErrorDetail(t, error.details)}</p>
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
