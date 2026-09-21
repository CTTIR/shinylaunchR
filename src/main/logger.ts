/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { LogEvent, LogLevel } from '@shared/types';

/** Decode complete bounded lines; oversized lines are discarded, never leaked as fragments. */
export class LineReader {
  private decoder = new StringDecoder('utf8');
  private tail = '';
  private overflow = false;
  constructor(
    private emit: (line: string) => void,
    private limit = 65536,
  ) {}
  push(chunk: Buffer): void {
    this.accept(this.decoder.write(chunk));
  }
  private accept(text: string): void {
    for (const part of text.split(/(?<=\n)/)) {
      if (!part) continue;
      if (!this.overflow) {
        if (this.tail.length + part.length > this.limit) {
          this.tail = '';
          this.overflow = true;
        } else this.tail += part;
      }
      if (part.endsWith('\n')) {
        this.emit(
          this.overflow
            ? '[oversized output line omitted]'
            : this.tail.replace(/\r?\n$/, ''),
        );
        this.tail = '';
        this.overflow = false;
      }
    }
  }
  end(): void {
    this.accept(this.decoder.end());
    if (this.overflow) this.emit('[oversized output line omitted]');
    else if (this.tail) this.emit(this.tail);
    this.tail = '';
    this.overflow = false;
  }
}

export class Logger extends EventEmitter {
  private stream: fs.WriteStream | null = null;
  private logFilePath: string | null = null;
  private bytes = 0;
  private rotating = false;
  private generation = 0;
  private secrets = new Set<string>();
  init(logDir: string): void {
    this.close();
    try {
      fs.mkdirSync(logDir, { recursive: true });
      this.logFilePath = path.join(logDir, 'shinylaunchR.log');
      this.bytes = fs.existsSync(this.logFilePath)
        ? fs.statSync(this.logFilePath).size
        : 0;
      if (this.bytes >= 5 * 1024 * 1024) this.rotateFile();
      this.openStream();
    } catch {
      this.stream = null;
    }
  }
  private openStream(): void {
    if (!this.logFilePath) return;
    const stream = fs.createWriteStream(this.logFilePath, {
      flags: 'a',
      mode: 0o600,
    });
    stream.on('error', () => {
      if (this.stream === stream) this.stream = null;
      stream.destroy();
    });
    this.stream = stream;
  }
  private rotateFile(): void {
    if (!this.logFilePath) return;
    try {
      fs.rmSync(this.logFilePath + '.1', { force: true });
      if (fs.existsSync(this.logFilePath))
        fs.renameSync(this.logFilePath, this.logFilePath + '.1');
      this.bytes = 0;
    } catch {
      this.logFilePath = null;
    }
  }
  get filePath(): string | null {
    return this.logFilePath;
  }
  addSecret(secret: string): void {
    if (secret.length > 0) this.secrets.add(secret);
  }
  // Reset is for isolated tests only; removing a credential must not forget an active child's secret.
  clearSecrets(): void {
    this.secrets.clear();
  }
  redact(text: string): string {
    let out = text;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      out = out.split(secret).join('«redacted»');
    return out.replace(
      /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
      '«redacted»',
    );
  }
  log(level: LogLevel, scope: string, message: string, appId?: string): void {
    const safe = this.redact(message).slice(0, 65536);
    const event: LogEvent = {
      ts: new Date().toISOString(),
      level,
      scope,
      appId,
      message: safe,
    };
    const line = `${event.ts} [${level.toUpperCase()}] (${scope}) ${safe}\n`;
    if (
      this.stream &&
      !this.rotating &&
      this.stream.writableLength < 1024 * 1024
    ) {
      this.stream.write(line);
      this.bytes += Buffer.byteLength(line);
      if (this.bytes >= 5 * 1024 * 1024) {
        this.rotating = true;
        const old = this.stream;
        this.stream = null;
        const generation = this.generation;
        old.end(() => {
          if (generation !== this.generation) return;
          this.rotateFile();
          this.rotating = false;
          this.openStream();
        });
      }
    }
    this.emit('log', event);
  }
  info(scope: string, message: string, appId?: string): void {
    this.log('info', scope, message, appId);
  }
  warn(scope: string, message: string, appId?: string): void {
    this.log('warn', scope, message, appId);
  }
  error(scope: string, message: string, appId?: string): void {
    this.log('error', scope, message, appId);
  }
  debug(scope: string, message: string, appId?: string): void {
    this.log('debug', scope, message, appId);
  }
  close(): void {
    this.generation++;
    this.rotating = false;
    this.stream?.end();
    this.stream = null;
  }
}
export const logger = new Logger();
