/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
/** One global mutation queue, with deduplication and cancellation before/after awaits. */
export class OperationCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private entries = new Map<
    string,
    { kind: string; controller: AbortController; promise: Promise<unknown> }
  >();
  private closing = false;
  private exclusive = false;
  constructor(private changed: () => void = () => {}) {}
  run<T>(
    id: string,
    kind: string,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.exclusive)
      return Promise.reject(new Error('Wait for runtime selection to finish.'));
    const active = this.entries.get(id);
    if (active) {
      if (active.kind === kind) return active.promise as Promise<T>;
      return Promise.reject(
        new Error(`Wait for ${active.kind} to finish or cancel it first.`),
      );
    }
    if (this.closing)
      return Promise.reject(new Error('Application is shutting down.'));
    const controller = new AbortController();
    const entry = {
      kind,
      controller,
      promise: Promise.resolve() as Promise<unknown>,
    };
    this.entries.set(id, entry);
    const promise = this.tail
      .catch(() => {})
      .then(async () => {
        controller.signal.throwIfAborted();
        return task(controller.signal);
      })
      .finally(() => {
        if (this.entries.get(id) === entry) this.entries.delete(id);
        this.changed();
      });
    entry.promise = promise;
    this.tail = promise;
    this.changed();
    return promise;
  }
  replace<T>(
    id: string,
    kind: string,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.exclusive)
      return Promise.reject(new Error('Wait for runtime selection to finish.'));
    const previous = this.entries.get(id);
    if (previous) {
      previous.controller.abort();
      this.entries.delete(id);
    }
    return this.run(id, kind, task);
  }
  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.closing || this.exclusive || this.entries.size)
      throw new Error(
        'Wait for active operations before changing the R runtime.',
      );
    this.exclusive = true;
    const pending = Promise.resolve().then(task);
    this.tail = pending;
    try {
      return await pending;
    } finally {
      this.exclusive = false;
    }
  }
  has(id: string): boolean {
    return this.entries.has(id);
  }
  kind(id: string): string | undefined {
    return this.entries.get(id)?.kind;
  }
  async cancel(id: string): Promise<void> {
    const r = this.entries.get(id);
    if (r) {
      r.controller.abort();
      await r.promise.catch(() => {});
    }
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    for (const r of this.entries.values()) r.controller.abort();
    await Promise.allSettled([
      this.tail,
      ...[...this.entries.values()].map((r) => r.promise),
    ]);
  }
}
