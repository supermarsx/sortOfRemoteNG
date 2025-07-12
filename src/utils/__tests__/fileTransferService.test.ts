import { describe, it, expect, vi } from 'vitest';
import { FileTransferService } from '../fileTransferService';

// Helper to get the first transfer for a connection
function firstTransfer(service: FileTransferService, id: string) {
  return service.getActiveTransfers(id)[0];
}

describe('FileTransferService activeTransfers', () => {
  it('tracks uploads and cleans up completed entries', async () => {
    vi.useFakeTimers();
    const service = new FileTransferService();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const promise = service.uploadFile('c1', file, '/remote/hello.txt');

    // Transfer should be registered immediately
    expect(service.getActiveTransfers('c1')).toHaveLength(1);
    expect(firstTransfer(service, 'c1').status).toBe('active');

    await vi.advanceTimersByTimeAsync(100); // complete upload
    await promise;

    expect(service.getActiveTransfers('c1')).toHaveLength(1);
    expect(firstTransfer(service, 'c1').status).toBe('completed');

    await vi.advanceTimersByTimeAsync(5000); // cleanup delay
    expect(service.getActiveTransfers('c1')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('tracks downloads and cleans up completed entries', async () => {
    vi.useFakeTimers();
    const service = new FileTransferService();

    // jsdom does not implement URL.createObjectURL so mock it
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    // @ts-ignore
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    // @ts-ignore
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    const promise = service.downloadFile('c2', '/remote/file.bin', 'file.bin');

    expect(service.getActiveTransfers('c2')).toHaveLength(1);
    expect(firstTransfer(service, 'c2').status).toBe('active');

    await vi.advanceTimersByTimeAsync(2000); // simulated download duration
    await promise;

    expect(service.getActiveTransfers('c2')).toHaveLength(1);
    expect(firstTransfer(service, 'c2').status).toBe('completed');

    await vi.advanceTimersByTimeAsync(5000);
    expect(service.getActiveTransfers('c2')).toHaveLength(0);
    vi.useRealTimers();

    // restore URL functions
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    HTMLAnchorElement.prototype.click = originalClick;
  }, 10000);
});
