/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AppEntry, LogEvent } from '@shared/types';
export type DisplayLog = LogEvent & { displayId: number };
export interface LogConsoleProps {
  logs: DisplayLog[];
  apps: AppEntry[];
  onClose: () => void;
  onClear: () => void;
}
const LogLine = memo(function LogLine({
  event,
  name,
}: {
  event: DisplayLog;
  name?: string;
}) {
  return (
    <div className={`log-line ${event.level}`}>
      <span className="ts">{event.ts.slice(11, 19)}</span> [{event.scope}
      {event.appId ? `:${name ?? event.appId.slice(0, 6)}` : ''}]{' '}
      {event.message}
    </div>
  );
});
export function LogConsole({ logs, apps, onClose, onClear }: LogConsoleProps) {
  const [filter, setFilter] = useState('all');
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const filtered = useMemo(
    () =>
      logs.filter(
        (e) =>
          filter === 'all' ||
          (filter === 'global' ? !e.appId : e.appId === filter),
      ),
    [logs, filter],
  );
  const names = useMemo(() => new Map(apps.map((a) => [a.id, a.name])), [apps]);
  const visible = filtered.slice(-400);
  useEffect(() => {
    if (follow.current && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [filtered]);
  return (
    <div className="log-console">
      <div className="log-head">
        <strong>Log Console</strong>
        <select
          aria-label="Filter logs"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            follow.current = true;
          }}
        >
          <option value="all">All</option>
          <option value="global">App / system</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          className="btn ghost"
          onClick={() => {
            follow.current = true;
            if (body.current)
              body.current.scrollTop = body.current.scrollHeight;
          }}
        >
          Latest
        </button>
        <button className="btn ghost" onClick={onClear}>
          Clear
        </button>
        <button className="btn ghost" onClick={onClose}>
          Hide
        </button>
      </div>
      <div
        className="log-body"
        ref={body}
        tabIndex={0}
        aria-label="Log output"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {filtered.length > 400 && (
          <div>Showing the latest 400 matching lines.</div>
        )}
        {!visible.length && <div>No log output yet.</div>}
        {visible.map((e) => (
          <LogLine
            key={e.displayId}
            event={e}
            name={e.appId ? names.get(e.appId) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
