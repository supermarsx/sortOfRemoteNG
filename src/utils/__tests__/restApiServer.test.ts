import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { Application } from 'express';
import { RestApiServer } from '../restApiServer';

describe('RestApiServer routes', () => {
  let server: RestApiServer;
  let app: Application;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
    server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret',
      connectionsStorePath: path.join(tempDir, 'connections.json'),
      sessionsStorePath: path.join(tempDir, 'sessions.json'),
    });
    app = (server as unknown as { app: Application }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('health check returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('can create and list connections', async () => {
    const createRes = await request(app)
      .post('/api/connections')
      .send({ name: 'test', protocol: 'ssh', hostname: 'localhost' });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get('/api/connections');
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].name).toBe('test');
  });
});

describe('Authentication', () => {
  let server: RestApiServer;
  let app: Application;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
    server = new RestApiServer({
      port: 0,
      authentication: true,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret',
      userStorePath: path.join(__dirname, '..', '..', '..', 'users.json'),
      connectionsStorePath: path.join(tempDir, 'connections.json'),
      sessionsStorePath: path.join(tempDir, 'sessions.json'),
    });
    app = (server as unknown as { app: Application }).app;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('allows login with valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects login with invalid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('protects routes without token', async () => {
    const res = await request(app).get('/api/connections');
    expect(res.status).toBe(401);
  });

  it('allows access to protected routes with valid token', async () => {
    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin' });
    const token = login.body.token;

    const res = await request(app)
      .get('/api/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('Persistence', () => {
  it('persists connections and sessions across restarts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
    const paths = {
      connectionsStorePath: path.join(tempDir, 'connections.json'),
      sessionsStorePath: path.join(tempDir, 'sessions.json'),
    };

    let server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret',
      ...paths,
    });
    await server.start();
    const app = (server as unknown as { app: Application }).app;

    const connRes = await request(app)
      .post('/api/connections')
      .send({ name: 'persist', protocol: 'ssh', hostname: 'localhost' });
    expect(connRes.status).toBe(201);
    const connectionId = connRes.body.id;

    const sessionRes = await request(app)
      .post('/api/sessions')
      .send({ connectionId });
    expect(sessionRes.status).toBe(201);

    await server.stop();

    server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret',
      ...paths,
    });
    await server.start();
    const app2 = (server as unknown as { app: Application }).app;

    const listConn = await request(app2).get('/api/connections');
    expect(listConn.body).toHaveLength(1);
    const listSess = await request(app2).get('/api/sessions');
    expect(listSess.body).toHaveLength(1);

    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
