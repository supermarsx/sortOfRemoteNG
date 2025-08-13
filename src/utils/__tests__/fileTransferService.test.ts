import { describe, it, expect, vi } from 'vitest';
import { FileTransferService, FileTransferAdapter } from '../fileTransferService';

function createMockAdapter(): FileTransferAdapter {
  return {
    list: vi.fn(async () => []),
    async upload(file, _remotePath, onProgress, signal) {
      const total = (file as File).size;
      let transferred = 0;
      const chunk = total / 5;
      while (transferred < total) {
        if (signal?.aborted) throw new Error('aborted');
        await new Promise(res => setTimeout(res, 100));
        if (signal?.aborted) throw new Error('aborted');
        transferred = Math.min(transferred + chunk, total);
        onProgress?.(transferred, total);
      }
    },
    async download(_remotePath, _localPath, onProgress, signal) {
      const total = 1000;
      let transferred = 0;
      const chunk = total / 5;
      while (transferred < total) {
        if (signal?.aborted) throw new Error('aborted');
        await new Promise(res => setTimeout(res, 100));
        if (signal?.aborted) throw new Error('aborted');
        transferred = Math.min(transferred + chunk, total);
        onProgress?.(transferred, total);
      }
    }
  };
}

function firstTransfer(service: FileTransferService, id: string) {
  return service.getActiveTransfers(id)[0];
}

describe('FileTransferService', () => {
  it('tracks uploads and emits progress', async () => {
    vi.useFakeTimers();
    const service = new FileTransferService();
    service.registerAdapter('c1', createMockAdapter());
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const progressSpy = vi.fn();
    service.on('progress', progressSpy);

    const promise = service.uploadFile('c1', file, '/remote/hello.txt');

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(progressSpy).toHaveBeenCalled();
    expect(firstTransfer(service, 'c1').status).toBe('completed');

    await vi.advanceTimersByTimeAsync(5000);
    expect(service.getActiveTransfers('c1')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('tracks downloads and cleans up completed entries', async () => {
    vi.useFakeTimers();
    const service = new FileTransferService();
    service.registerAdapter('c2', createMockAdapter());

    const promise = service.downloadFile('c2', '/remote/file.bin', 'file.bin');

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(firstTransfer(service, 'c2').status).toBe('completed');

    await vi.advanceTimersByTimeAsync(5000);
    expect(service.getActiveTransfers('c2')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('supports cancellation via AbortController', async () => {
    vi.useFakeTimers();
    const service = new FileTransferService();
    service.registerAdapter('c3', createMockAdapter());
    const file = new File(['hello'], 'hello.txt');

    const promise = service.uploadFile('c3', file, '/remote/hello.txt');
    const transferId = firstTransfer(service, 'c3').id;
    service.cancelTransfer(transferId);

    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(firstTransfer(service, 'c3').status).toBe('cancelled');
    vi.useRealTimers();
  });
});

