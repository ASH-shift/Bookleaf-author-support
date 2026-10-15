import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data with loading/error state. `reload()` refetches without clearing current data. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const latest = useRef(0);

  const run = useCallback(() => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => { if (id === latest.current) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (id === latest.current) setState((s) => ({ ...s, error, loading: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
