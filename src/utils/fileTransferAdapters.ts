import type { File as NodeFile } from 'buffer';

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  permissions?: string;
}

export interface FileTransferAdapter {
  list(path: string, signal?: AbortSignal): Promise<FileItem[]>;
  upload(
    file: File | NodeFile | Buffer,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void>;
  download(
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void>;
}

// SFTP implementation using ssh2-sftp-client
export class SFTPAdapter implements FileTransferAdapter {
  private client: any;
  constructor(private config: any) {}

  private async getClient() {
    if (!this.client) {
      const SftpClient = (await import(/* @vite-ignore */ 'ssh2-sftp-client')).default;
      this.client = new SftpClient();
      await this.client.connect(this.config);
    }
    return this.client;
  }

  async list(path: string, signal?: AbortSignal): Promise<FileItem[]> {
    const client = await this.getClient();
    if (signal?.aborted) throw new Error('aborted');
    const items = await client.list(path);
    return items.map((item: any) => ({
      name: item.name,
      type: item.type === 'd' ? 'directory' : 'file',
      size: item.size,
      modified: new Date(item.modifyTime || Date.now()),
      permissions: item.rights?.user + item.rights?.group + item.rights?.other,
    }));
  }

  async upload(
    file: File | NodeFile | Buffer,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const client = await this.getClient();
    const buffer = file instanceof Buffer ? file : Buffer.from(await (file as any).arrayBuffer());
    const total = buffer.length;
    const options: any = {};
    if (onProgress) {
      options.step = (transferred: number, _chunk: number, totalSize: number) => {
        onProgress(transferred, totalSize);
        if (signal?.aborted) {
          throw new Error('aborted');
        }
      };
    }
    await client.put(buffer, remotePath, options);
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const client = await this.getClient();
    const options: any = {};
    if (onProgress) {
      options.step = (transferred: number, _chunk: number, totalSize: number) => {
        onProgress(transferred, totalSize);
        if (signal?.aborted) {
          throw new Error('aborted');
        }
      };
    }
    await client.fastGet(remotePath, localPath, options);
  }
}

// SCP implementation using scp2
export class SCPAdapter implements FileTransferAdapter {
  private client: any;
  constructor(private config: any) {}

  private async getClient() {
    if (!this.client) {
      const scp2 = await import(/* @vite-ignore */ 'scp2');
      this.client = new (scp2 as any).Client();
      this.client.defaults(this.config);
    }
    return this.client;
  }

  async list(_path: string, _signal?: AbortSignal): Promise<FileItem[]> {
    throw new Error('SCP does not support directory listing');
  }

  async upload(
    file: File | NodeFile | Buffer,
    remotePath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const client = await this.getClient();
    const buffer = file instanceof Buffer ? file : Buffer.from(await (file as any).arrayBuffer());
    const total = buffer.length;
    await new Promise<void>((resolve, reject) => {
      client.upload(buffer, remotePath, (err: Error) => {
        if (err) return reject(err);
        resolve();
      }).on('transfer', (buf: Buffer, uploaded: number, _remote: string) => {
        onProgress?.(uploaded, total);
        if (signal?.aborted) {
          reject(new Error('aborted'));
        }
      });
    });
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (transferred: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const client = await this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.download(remotePath, localPath, (err: Error) => {
        if (err) return reject(err);
        resolve();
      }).on('transfer', (buf: Buffer, downloaded: number, _remote: string) => {
        onProgress?.(downloaded, buf.length);
        if (signal?.aborted) {
          reject(new Error('aborted'));
        }
      });
    });
  }
}

