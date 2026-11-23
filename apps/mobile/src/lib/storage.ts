import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * A small value remembered on this phone (a draft, a chosen model…). `ready` is false until the
 * saved value has been read, so a screen doesn't overwrite it with its initial state.
 */
export function useStored(key: string, initial = ''): [string, (next: string) => void, boolean] {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .then((saved) => {
        if (!live) return;
        setValue(saved ?? initial);
        setReady(true);
      })
      .catch(() => live && setReady(true));
    return () => {
      live = false;
    };
    // `initial` is only the starting value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      void (next ? AsyncStorage.setItem(key, next) : AsyncStorage.removeItem(key)).catch(() => undefined);
    },
    [key],
  );
  return [value, set, ready];
}
