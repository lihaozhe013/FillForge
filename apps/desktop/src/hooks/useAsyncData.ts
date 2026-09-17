import { useCallback, useEffect, useRef, useState } from 'react';
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
  dependencies: unknown[]
): { data: T | null; error: AppErrorDtoLike | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppErrorDtoLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  // Callers pass inline closures, so `loader` identity changes on every render;
  // keep it in a ref so re-renders do not retrigger the effect, while the effect
  // always invokes the latest closure (with fresh captured props).
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `dependencies` is a caller-supplied, variable-length key and `tick` drives manual reloads; `loader` is read through loaderRef so its per-render identity never retriggers the effect.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
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
  }, [...dependencies, tick]);

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
