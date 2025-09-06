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

async function firstTransfer(service: FileTransferService, id: string) {
  return (await service.getActiveTransfers(id))[0];
}

describe('FileTransferService', () => {
  it('tracks uploads and emits progress', async () => {
    const service = new FileTransferService();
    service.registerAdapter('c1', createMockAdapter());
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const progressSpy = vi.fn();
    service.on('progress', progressSpy);

    await service.uploadFile('c1', file, '/remote/hello.txt');

    expect(progressSpy).toHaveBeenCalled();
    expect((await firstTransfer(service, 'c1')).status).toBe('completed');
  });

  it('tracks downloads and emits completion', async () => {
    const service = new FileTransferService();
    service.registerAdapter('c2', createMockAdapter());

    await service.downloadFile('c2', '/remote/file.bin', 'file.bin');

    expect((await firstTransfer(service, 'c2')).status).toBe('completed');
  });

  it('supports cancellation via AbortController', async () => {
    const service = new FileTransferService();
    service.registerAdapter('c3', createMockAdapter());
    const file = new File(['hello'], 'hello.txt');

    let transferId = '';
    service.on('start', s => {
      transferId = s.id;
      setTimeout(() => service.cancelTransfer(transferId), 150);
    });

    await service.uploadFile('c3', file, '/remote/hello.txt');

    expect((await firstTransfer(service, 'c3')).status).toBe('cancelled');
  });
});

