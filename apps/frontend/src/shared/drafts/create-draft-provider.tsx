'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { createDraftKey } from './create-draft-key';
import { CreateSubmissionStore } from './create-submission-store';

type DraftSnapshot<T> = { value: T; dirty: boolean };

class CreateDraftStore {
  readonly submissions = new CreateSubmissionStore();
  private values = new Map<string, DraftSnapshot<unknown>>();
  private listeners = new Set<() => void>();

  constructor(private readonly userId: string) {}

  draftKey(pathname: string, query: string, formKey: string): string {
    return createDraftKey(this.userId, pathname, query, formKey);
  }

  ensure<T>(key: string, initialValue: T): DraftSnapshot<T> {
    let snapshot = this.values.get(key);
    if (!snapshot) {
      snapshot = { value: initialValue, dirty: false };
      this.values.set(key, snapshot);
    }
    return snapshot as DraftSnapshot<T>;
  }

  read<T>(key: string, initialValue: T): DraftSnapshot<T> {
    return this.ensure(key, initialValue);
  }

  write<T>(key: string, snapshot: DraftSnapshot<T>): void {
    this.values.set(key, snapshot);
    this.emit();
  }

  clear(key: string): void {
    this.submissions.cancelCompletion(key);
    this.values.delete(key);
    this.emit();
  }

  clearAll(): void {
    this.values.clear();
    this.emit();
  }

  hasDirty(): boolean {
    for (const snapshot of this.values.values()) {
      if (snapshot.dirty) return true;
    }
    return false;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const DraftStoreContext = createContext<CreateDraftStore | null>(null);

export function CreateDraftProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <UserScopedDraftProvider key={userId} userId={userId}>
      {children}
    </UserScopedDraftProvider>
  );
}

function UserScopedDraftProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const storeRef = useRef<CreateDraftStore | null>(null);
  if (!storeRef.current) storeRef.current = new CreateDraftStore(userId);
  const store = storeRef.current;
  const pathname = usePathname();
  useEffect(() => { store.submissions.observePathname(pathname); }, [pathname, store]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!store.hasDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      store.clearAll();
    };
  }, [store]);

  return <DraftStoreContext.Provider value={store}>{children}</DraftStoreContext.Provider>;
}

export interface CreateDraft<T> {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  update: (updater: (current: T) => T) => void;
  clear: () => void;
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  submitting: boolean;
  submit: <R>(operation: () => Promise<R>) => Promise<R>;
  clearAfterNavigation: (pathname: string) => void;
}

/** In-memory draft keyed by authenticated user, route pathname, and exact query string. */
export function useCreateDraft<T>(key: string, initialValue: T): CreateDraft<T> {
  const store = useContext(DraftStoreContext);
  if (!store) throw new Error('useCreateDraft must be used within CreateDraftProvider');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const scopedKey = store.draftKey(pathname, query, key);
  const submitting = useSyncExternalStore(
    store.submissions.subscribe,
    () => store.submissions.isPending(scopedKey),
    () => store.submissions.isPending(scopedKey),
  );
  const submit = useCallback(<R,>(operation: () => Promise<R>): Promise<R> =>
    store.submissions.run(scopedKey, operation), [scopedKey, store]);
  const clearAfterNavigation = useCallback((target: string): void => {
    store.submissions.clearAfterNavigation(scopedKey, target, () => store.clear(scopedKey));
  }, [scopedKey, store]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    () => store.read(scopedKey, initialValue),
    () => store.read(scopedKey, initialValue),
  );

  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (next) => {
      const current = store.read(scopedKey, initialValue);
      const value = typeof next === 'function'
        ? (next as (previous: T) => T)(current.value)
        : next;
      store.write(scopedKey, { value, dirty: true });
    },
    [initialValue, scopedKey, store],
  );
  const update = useCallback((updater: (current: T) => T): void => {
    setValue(updater);
  }, [setValue]);
  const setDirty = useCallback((dirty: boolean): void => {
    const current = store.read(scopedKey, initialValue);
    store.write(scopedKey, { ...current, dirty });
  }, [initialValue, scopedKey, store]);
  const clear = useCallback((): void => {
    store.clear(scopedKey);
  }, [scopedKey, store]);

  return useMemo(() => ({
    value: snapshot.value,
    setValue,
    update,
    clear,
    dirty: snapshot.dirty,
    setDirty,
    submitting,
    submit,
    clearAfterNavigation,
  }), [clear, setDirty, setValue, snapshot, update, submitting, submit, clearAfterNavigation]);
}

