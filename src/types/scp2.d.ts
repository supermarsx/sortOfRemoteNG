declare module 'scp2' {
  interface ScpConfig {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }

  class Client {
    constructor();
    defaults(config: ScpConfig): void;
    download(src: string, dest: string, callback?: (err?: Error) => void): void;
    upload(src: string, dest: string, callback?: (err?: Error) => void): void;
  }

  export = {
    Client: Client
  };
}