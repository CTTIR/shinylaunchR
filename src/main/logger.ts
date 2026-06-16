/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structured logging: writes to a rotating-ish log file and emits events that
 * the IPC layer forwards to the renderer's Log Console. Electron-free so it can
 * be unit-tested in isolation.
 *
 * Secret redaction: register secret substrings (e.g. a GitHub PAT) and they are
 * masked everywhere — file and UI stream — before being written.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { LogEvent, LogLevel } from '@shared/types';

class Logger extends EventEmitter {
  private stream: fs.WriteStream | null = null;
  private logFilePath: string | null = null;
  private secrets = new Set<string>();

  /** Point the logger at a directory; opens (or creates) shinylaunchR.log. */
  init(logDir: string): void {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      this.logFilePath = path.join(logDir, 'shinylaunchR.log');
      this.stream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    } catch (err) {
      // Logging must never crash the app; fall back to console only.
      // eslint-disable-next-line no-console
      console.error('[logger] failed to open log file', err);
    }
  }

  get filePath(): string | null {
    return this.logFilePath;
  }

  /** Register a secret to be redacted from all future log output. */
  addSecret(secret: string): void {
    if (secret && secret.length >= 4) this.secrets.add(secret);
  }

  clearSecrets(): void {
    this.secrets.clear();
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (!secret) continue;
      out = out.split(secret).join('«redacted»');
    }
    // Defensive: also mask anything that looks like a GitHub token.
    out = out.replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, '«redacted»');
    return out;
  }

  log(level: LogLevel, scope: string, message: string, appId?: string): void {
    const safe = this.redact(message);
    const event: LogEvent = {
      ts: new Date().toISOString(),
      level,
      scope,
      appId,
      message: safe,
    };
    const line = `${event.ts} [${level.toUpperCase()}] (${scope}) ${safe}\n`;
    if (this.stream) {
      this.stream.write(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line.trimEnd());
    }
    this.emit('log', event);
  }

  info(scope: string, message: string, appId?: string) {
    this.log('info', scope, message, appId);
  }
  warn(scope: string, message: string, appId?: string) {
    this.log('warn', scope, message, appId);
  }
  error(scope: string, message: string, appId?: string) {
    this.log('error', scope, message, appId);
  }
  debug(scope: string, message: string, appId?: string) {
    this.log('debug', scope, message, appId);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

export const logger = new Logger();
export type { Logger };
