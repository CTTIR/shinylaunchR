import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppEntry, LogEvent } from '@shared/types';

export interface LogConsoleProps {
  logs: LogEvent[];
  apps: AppEntry[];
  onClose: () => void;
  onClear: () => void;
}

export function LogConsole({ logs, apps, onClose, onClear }: LogConsoleProps) {
  const [filterApp, setFilterApp] = useState<string>('all');
  const bodyRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (filterApp === 'all') return logs;
    if (filterApp === 'global') return logs.filter((l) => !l.appId);
    return logs.filter((l) => l.appId === filterApp);
  }, [logs, filterApp]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length]);

  const nameFor = (id?: string) => apps.find((a) => a.id === id)?.name;

  return (
    <div className="log-console">
      <div className="log-head">
        <strong>Log Console</strong>
        <select value={filterApp} onChange={(e) => setFilterApp(e.target.value)}>
          <option value="all">All</option>
          <option value="global">App / system</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClear}>
          Clear
        </button>
        <button className="btn ghost" onClick={onClose}>
          Hide
        </button>
      </div>
      <div className="log-body" ref={bodyRef}>
        {filtered.length === 0 && (
          <div style={{ color: 'var(--text-faint)' }}>No log output yet.</div>
        )}
        {filtered.map((l, i) => (
          <div key={i} className={`log-line ${l.level}`}>
            <span className="ts">{l.ts.slice(11, 19)}</span> [{l.scope}
            {l.appId ? `:${nameFor(l.appId) ?? l.appId.slice(0, 6)}` : ''}] {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}
