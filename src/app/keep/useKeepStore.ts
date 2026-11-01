import { useEffect, useMemo, useState } from "react";
import { type KeepDeps, type KeepState, KeepStore } from "../../keep/keepStore";

/** One KEEP store per management page, initialized on mount and disposed on unmount. */
export function useKeepStore(makeDeps: () => KeepDeps): { store: KeepStore; state: KeepState } {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the store is created once per page
  const store = useMemo(() => new KeepStore(makeDeps()), []);
  const [state, setState] = useState<KeepState>(store.current);
  useEffect(() => {
    const unsubscribe = store.subscribe(setState);
    void store.init();
    return () => {
      unsubscribe();
      store.dispose();
    };
  }, [store]);
  return { store, state };
}
