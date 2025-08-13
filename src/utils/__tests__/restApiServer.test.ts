import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import type { Application } from 'express';
import { RestApiServer } from '../restApiServer';

describe('RestApiServer routes', () => {
  let server: RestApiServer;
  let app: Application;

  beforeEach(() => {
    server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret'
    });
    app = (server as unknown as { app: Application }).app;
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

  beforeEach(() => {
    server = new RestApiServer({
      port: 0,
      authentication: true,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret',
      userStorePath: path.join(__dirname, '..', '..', '..', 'users.json'),
    });
    app = (server as unknown as { app: Application }).app;
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
