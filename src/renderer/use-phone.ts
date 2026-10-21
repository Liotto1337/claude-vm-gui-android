import { useSyncExternalStore } from 'react';

/** Телефонная раскладка — уже 840 px; шире (планшет горизонтально) — как на Windows. */
export const PHONE_QUERY = '(max-width: 839.98px)';

const query = () => (typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null);

export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = query();
      q?.addEventListener('change', cb);
      return () => q?.removeEventListener('change', cb);
    },
    () => query()?.matches ?? false,
  );
}
