import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { RestApiServer } from '../restApiServer';

describe('RestApiServer routes', () => {
  let server: RestApiServer;
  let app: any;

  beforeEach(() => {
    server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: 'secret'
    });
    app = (server as any).app;
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
