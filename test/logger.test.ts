import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Logger } from '../src/main/logger';
afterEach(() => vi.restoreAllMocks());
it('survives asynchronous file errors while continuing redacted event delivery', () => {
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    writableLength: 0,
  });
  vi.spyOn(fs, 'createWriteStream').mockReturnValue(
    stream as unknown as fs.WriteStream,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-log-'));
  try {
    const log = new Logger();
    log.init(dir);
    stream.emit('error', new Error('disk full'));
    const events: string[] = [];
    log.on('log', (e) => events.push(e.message));
    log.addSecret('fake-secret');
    log.info('test', 'fake-secret');
    expect(events).toEqual(['«redacted»']);
    expect(stream.destroy).toHaveBeenCalled();
    expect(stream.write).not.toHaveBeenCalled();
    log.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it('bounds queued disk writes without suppressing live events', () => {
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    writableLength: 1024 * 1024,
  });
  vi.spyOn(fs, 'createWriteStream').mockReturnValue(
    stream as unknown as fs.WriteStream,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-log-'));
  try {
    const log = new Logger();
    log.init(dir);
    const event = vi.fn();
    log.on('log', event);
    log.info('test', 'message');
    expect(stream.write).not.toHaveBeenCalled();
    expect(event).toHaveBeenCalledOnce();
    log.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it('retains one rotated log and cannot reopen after close during rotation', () => {
  let ended: (() => void) | undefined;
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn((fn?: () => void) => {
      ended = fn;
    }),
    destroy: vi.fn(),
    writableLength: 0,
  });
  const open = vi
    .spyOn(fs, 'createWriteStream')
    .mockReturnValue(stream as unknown as fs.WriteStream);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-log-'));
  try {
    const file = path.join(dir, 'shinylaunchR.log');
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024));
    fs.writeFileSync(file + '.1', 'older');
    const log = new Logger();
    log.init(dir);
    expect(fs.statSync(file + '.1').size).toBe(5 * 1024 * 1024);
    for (let i = 0; i < 81; i++) log.info('test', 'x'.repeat(65536));
    expect(ended).toBeTypeOf('function');
    log.close();
    ended!();
    expect(open).toHaveBeenCalledOnce();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
