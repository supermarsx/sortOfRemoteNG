import { EventEmitter } from 'events';
import type { FileTransferSession } from '../types/connection';
import { generateId } from './id';
import { FileTransferAdapter, FileItem } from './fileTransferAdapters';
import { IndexedDbService } from './indexedDbService';

export type { FileTransferAdapter, FileItem } from './fileTransferAdapters';

export class FileTransferService extends EventEmitter {
  private adapters = new Map<string, FileTransferAdapter>();
  private controllers = new Map<string, AbortController>();
  private readonly storageKey = 'mremote-file-transfers';

  private async loadSessions(): Promise<FileTransferSession[]> {
    return (await IndexedDbService.getItem<FileTransferSession[]>(this.storageKey)) || [];
  }

  private async saveSession(session: FileTransferSession): Promise<void> {
    const sessions = await this.loadSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index >= 0) {
      sessions[index] = { ...session };
    } else {
      sessions.push({ ...session });
    }
    await IndexedDbService.setItem(this.storageKey, sessions);
  }

  private async getSession(id: string): Promise<FileTransferSession | undefined> {
    const sessions = await this.loadSessions();
    return sessions.find(s => s.id === id);
  }

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
    this.controllers.set(transferId, controller);
    void this.saveSession(session);
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
    await this.saveSession(session);

    try {
      await adapter.upload(
        file,
        remotePath,
        (transferred, total) => {
          session.transferredSize = transferred;
          session.totalSize = total;
          session.progress = (transferred / total) * 100;
          void this.saveSession(session);
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
      await this.saveSession(session);
      if (session.status === 'completed') {
        this.emit('end', session);
      } else if (this.listenerCount('error') > 0) {
        this.emit('error', session);
      }
      this.controllers.delete(id);
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
    await this.saveSession(session);

    try {
      await adapter.download(
        remotePath,
        localPath,
        (transferred, total) => {
          session.transferredSize = transferred;
          session.totalSize = total;
          session.progress = total ? (transferred / total) * 100 : 0;
          void this.saveSession(session);
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
      await this.saveSession(session);
      if (session.status === 'completed') {
        this.emit('end', session);
      } else if (this.listenerCount('error') > 0) {
        this.emit('error', session);
      }
      this.controllers.delete(id);
    }
  }

  async getActiveTransfers(connectionId: string): Promise<FileTransferSession[]> {
    const sessions = await this.loadSessions();
    return sessions.filter(t => t.connectionId === connectionId);
  }

  cancelTransfer(transferId: string): void {
    const controller = this.controllers.get(transferId);
    if (controller) controller.abort();
  }

  async resumeTransfer(transferId: string, file?: File | Buffer): Promise<void> {
    const session = await this.getSession(transferId);
    if (!session) throw new Error('Transfer session not found');
    if (session.status === 'completed') return;
    const adapter = this.adapters.get(session.connectionId);
    if (!adapter) throw new Error('No adapter registered for connection');

    const controller = new AbortController();
    this.controllers.set(transferId, controller);
    session.status = 'active';
    session.error = undefined;
    await this.saveSession(session);
    this.emit('start', session);

    const progressHandler = (transferred: number, total: number) => {
      const already = session.transferredSize || 0;
      session.totalSize = total || session.totalSize;
      session.transferredSize = Math.min(already + transferred, session.totalSize);
      session.progress = session.totalSize
        ? (session.transferredSize / session.totalSize) * 100
        : 0;
      void this.saveSession(session);
      this.emit('progress', {
        id: transferId,
        progress: session.progress,
        transferred: session.transferredSize,
        total: session.totalSize,
      });
    };

    try {
      if (session.type === 'upload') {
        if (!file) throw new Error('File required to resume upload');
        await adapter.upload(
          file as any,
          session.remotePath,
          progressHandler,
          controller.signal,
        );
      } else {
        await adapter.download(
          session.remotePath,
          session.localPath,
          progressHandler,
          controller.signal,
        );
      }
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
      await this.saveSession(session);
      if (session.status === 'completed') {
        this.emit('end', session);
      } else if (this.listenerCount('error') > 0) {
        this.emit('error', session);
      }
      this.controllers.delete(transferId);
    }
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

