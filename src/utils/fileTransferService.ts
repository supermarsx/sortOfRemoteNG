import { EventEmitter } from 'events';
import type { FileTransferSession } from '../types/connection';
import { generateId } from './id';
import { FileTransferAdapter, FileItem } from './fileTransferAdapters';

export { FileTransferAdapter, FileItem } from './fileTransferAdapters';

export class FileTransferService extends EventEmitter {
  private activeTransfers = new Map<string, FileTransferSession>();
  private adapters = new Map<string, FileTransferAdapter>();
  private controllers = new Map<string, AbortController>();

  registerAdapter(connectionId: string, adapter: FileTransferAdapter) {
    this.adapters.set(connectionId, adapter);
  }

  async listDirectory(
    connectionId: string,
    path: string,
    options?: { signal?: AbortSignal }
  ): Promise<FileItem[]> {
    const adapter = this.adapters.get(connectionId);
    if (!adapter) throw new Error('No adapter registered for connection');
    return adapter.list(path, options?.signal);
  }

  private createSession(
    connectionId: string,
    type: 'upload' | 'download',
    localPath: string,
    remotePath: string,
    totalSize: number
  ): [string, FileTransferSession, AbortController] {
    const transferId = generateId();
    const controller = new AbortController();
    const session: FileTransferSession = {
      id: transferId,
      connectionId,
      type,
      localPath,
      remotePath,
      progress: 0,
      status: 'pending',
      startTime: new Date(),
      totalSize,
      transferredSize: 0,
    };
    this.activeTransfers.set(transferId, session);
    this.controllers.set(transferId, controller);
    return [transferId, session, controller];
  }

  async uploadFile(
    connectionId: string,
    file: File,
    remotePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const adapter = this.adapters.get(connectionId);
    if (!adapter) throw new Error('No adapter registered for connection');
    const [id, session, controller] = this.createSession(
      connectionId,
      'upload',
      file.name,
      remotePath,
      file.size
    );
    if (options?.signal) options.signal.addEventListener('abort', () => controller.abort());
    session.status = 'active';
    this.emit('start', session);

    try {
      await adapter.upload(
        file,
        remotePath,
        (transferred, total) => {
          session.transferredSize = transferred;
          session.totalSize = total;
          session.progress = (transferred / total) * 100;
          this.activeTransfers.set(id, { ...session });
          this.emit('progress', { id, progress: session.progress, transferred, total });
        },
        controller.signal
      );
      session.status = 'completed';
    } catch (err) {
      if (controller.signal.aborted) {
        session.status = 'cancelled';
      } else {
        session.status = 'error';
        session.error = (err as Error).message;
      }
    } finally {
      session.endTime = new Date();
      this.activeTransfers.set(id, { ...session });
      if (session.status === 'completed') {
        this.emit('end', session);
      } else if (this.listenerCount('error') > 0) {
        this.emit('error', session);
      }
      this.controllers.delete(id);
      setTimeout(() => this.activeTransfers.delete(id), 5000);
    }
  }

  async downloadFile(
    connectionId: string,
    remotePath: string,
    localPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const adapter = this.adapters.get(connectionId);
    if (!adapter) throw new Error('No adapter registered for connection');
    const [id, session, controller] = this.createSession(
      connectionId,
      'download',
      localPath,
      remotePath,
      0
    );
    if (options?.signal) options.signal.addEventListener('abort', () => controller.abort());
    session.status = 'active';
    this.emit('start', session);

    try {
      await adapter.download(
        remotePath,
        localPath,
        (transferred, total) => {
          session.transferredSize = transferred;
          session.totalSize = total;
          session.progress = total ? (transferred / total) * 100 : 0;
          this.activeTransfers.set(id, { ...session });
          this.emit('progress', { id, progress: session.progress, transferred, total });
        },
        controller.signal
      );
      session.status = 'completed';
    } catch (err) {
      if (controller.signal.aborted) {
        session.status = 'cancelled';
      } else {
        session.status = 'error';
        session.error = (err as Error).message;
      }
    } finally {
      session.endTime = new Date();
      this.activeTransfers.set(id, { ...session });
      if (session.status === 'completed') {
        this.emit('end', session);
      } else if (this.listenerCount('error') > 0) {
        this.emit('error', session);
      }
      this.controllers.delete(id);
      setTimeout(() => this.activeTransfers.delete(id), 5000);
    }
  }

  getActiveTransfers(connectionId: string): FileTransferSession[] {
    return Array.from(this.activeTransfers.values()).filter(
      t => t.connectionId === connectionId
    );
  }

  cancelTransfer(transferId: string): void {
    const controller = this.controllers.get(transferId);
    if (controller) controller.abort();
  }

  // Optional adapter-specific helpers
  async deleteFile(connectionId: string, remotePath: string): Promise<void> {
    const adapter: any = this.adapters.get(connectionId);
    await adapter?.delete?.(remotePath);
  }

  async createDirectory(connectionId: string, path: string): Promise<void> {
    const adapter: any = this.adapters.get(connectionId);
    await adapter?.mkdir?.(path);
  }

  async renameFile(
    connectionId: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const adapter: any = this.adapters.get(connectionId);
    await adapter?.rename?.(oldPath, newPath);
  }

  async changePermissions(
    connectionId: string,
    path: string,
    permissions: string
  ): Promise<void> {
    const adapter: any = this.adapters.get(connectionId);
    await adapter?.chmod?.(path, permissions);
  }

  async scpUpload(
    connectionId: string,
    localFile: File,
    remotePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.uploadFile(connectionId, localFile, remotePath, options);
  }

  async scpDownload(
    connectionId: string,
    remotePath: string,
    localPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.downloadFile(connectionId, remotePath, localPath, options);
  }
}

