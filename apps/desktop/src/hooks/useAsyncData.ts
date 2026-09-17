import { useCallback, useEffect, useState } from 'react';
import type { AppErrorDtoLike } from '../lib/ipc-protocol';

export function extractError(error: unknown): AppErrorDtoLike {
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = error as AppErrorDtoLike & { details?: unknown };
    return {
      code: candidate.code,
      message: candidate.message,
      ...(candidate.details === undefined ? {} : { details: candidate.details })
    };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error)
  };
}

/**
 * Small loader helper around local state; renderer state is never canonical,
 * it only mirrors what the main process reports from the filesystem.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  _dependencies: unknown[]
): { data: T | null; error: AppErrorDtoLike | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [_tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(extractError(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader]);

  return { data, error, loading, reload };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
