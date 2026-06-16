/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Crash-safe ledger of the OS process IDs we have spawned for running Shiny
 * apps. It is persisted to a small JSON file so that if the app is force-killed
 * or crashes — skipping the normal `stopAll` on quit — the NEXT startup can find
 * and reap the R processes left behind. On Windows those orphans hold any
 * compiled-package `.dll` they loaded locked, which then blocks every reinstall
 * with "Failed to move installed package"; reaping them on startup is what keeps
 * the managed library installable across an unclean shutdown.
 *
 * All I/O is best-effort: a missing or unreadable ledger only costs us the
 * convenience of orphan reaping, so it must never throw into the caller.
 */
import fs from 'node:fs';

export interface LedgerFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
}

export class PidLedger {
  constructor(
    private readonly file: string,
    private readonly fsLike: LedgerFs = fs,
  ) {}

  /** Currently-recorded PIDs (deduped, positive integers only). */
  list(): number[] {
    try {
      if (!this.fsLike.existsSync(this.file)) return [];
      const data: unknown = JSON.parse(this.fsLike.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data)) return [];
      return [...new Set(data.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))];
    } catch {
      return [];
    }
  }

  private write(pids: number[]): void {
    try {
      this.fsLike.writeFileSync(this.file, JSON.stringify([...new Set(pids)]));
    } catch {
      // best-effort persistence
    }
  }

  add(pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0) return;
    this.write([...this.list(), pid]);
  }

  remove(pid: number): void {
    this.write(this.list().filter((p) => p !== pid));
  }

  clear(): void {
    this.write([]);
  }
}
