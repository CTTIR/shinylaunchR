/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import { readAtomicJson, writeAtomicJson } from './atomic-store';

export interface ProcessIdentity {
  pid: number;
  started: string;
  executable: string;
  marker: string;
}
export class PidLedger {
  constructor(private file: string) {}
  list(): ProcessIdentity[] {
    return readAtomicJson(
      this.file,
      (data: unknown) => {
        if (!Array.isArray(data)) throw new Error('Invalid PID ledger schema');
        // Legacy PID-only records cannot establish ownership and must never be reaped.
        return data.filter(
          (r): r is ProcessIdentity =>
            !!r &&
            typeof r === 'object' &&
            Number.isInteger(r.pid) &&
            r.pid > 0 &&
            typeof r.started === 'string' &&
            !!r.started &&
            typeof r.executable === 'string' &&
            !!r.executable &&
            typeof r.marker === 'string' &&
            /^[a-f0-9-]{36}$/.test(r.marker),
        );
      },
      () => [],
    );
  }
  add(record: ProcessIdentity): void {
    this.write([...this.list().filter((r) => r.pid !== record.pid), record]);
  }
  remove(pid: number): void {
    this.write(this.list().filter((r) => r.pid !== pid));
  }
  private write(records: ProcessIdentity[]): void {
    writeAtomicJson(this.file, records);
  }
}
