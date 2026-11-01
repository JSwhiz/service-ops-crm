/** Provider-owned, session-only locks. Promise settlement does not depend on a mounted form. */
export class CreateSubmissionStore {
  private pending = new Set<string>();
  private completions = new Map<string, { pathname: string; clear: () => void }>();
  private pathname = '';
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isPending(key: string): boolean { return this.pending.has(key); }

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.pending.has(key)) throw new Error('Сохранение уже выполняется. Дождитесь ответа.');
    this.pending.add(key);
    this.emit();
    try { return await operation(); }
    finally { this.pending.delete(key); this.emit(); }
  }

  clearAfterNavigation(key: string, pathname: string, clear: () => void): void {
    this.completions.set(key, { pathname, clear });
    this.observePathname(this.pathname);
  }

  cancelCompletion(key: string): void { this.completions.delete(key); }

  observePathname(pathname: string): void {
    this.pathname = pathname;
    for (const [key, completion] of this.completions) {
      if (completion.pathname !== pathname) continue;
      this.completions.delete(key);
      completion.clear();
    }
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
