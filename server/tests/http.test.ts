import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { createApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const ADMIN_PASSWORD = 'test-passwort-123';

function makeConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    ADMIN_PASSWORD,
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    PORT: '0',
  } as NodeJS.ProcessEnv);
}

describe('HTTP-API', () => {
  let context: AppContext;
  let baseUrl: string;

  beforeEach(async () => {
    context = createApp({ config: makeConfig(), dbPath: ':memory:', clientDist: null });
    await new Promise<void>((resolve) => context.server.listen(0, resolve));
    const address = context.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await context.close();
  });

  async function moderatorToken(): Promise<string> {
    const response = await request(context.app)
      .post('/api/auth/moderator')
      .send({ user: 'moderator', password: ADMIN_PASSWORD })
      .expect(200);
    return response.body.token as string;
  }

  it('liefert einen Health-Status', async () => {
    const response = await request(context.app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('liefert Metadaten mit allen Themengebieten', async () => {
    const response = await request(context.app).get('/api/meta').expect(200);
    const ids = (response.body.topics as { id: string }[]).map((t) => t.id);
    expect(ids).toContain('oeffentliches_recht_gewerberecht');
    expect(ids).toContain('sicherheitstechnik');
    expect(ids).toHaveLength(6);
  });

  it('weist falsche Zugangsdaten ab', async () => {
    await request(context.app).post('/api/auth/moderator').send({ user: 'moderator', password: 'falsch' }).expect(401);
  });

  it('weist den Fragenkatalog ohne Moderatorenzugang ab', async () => {
    await request(context.app).get('/api/questions').expect(401);
  });

  it('akzeptiert einen gueltigen Basic-Zugang', async () => {
    const credentials = Buffer.from(`moderator:${ADMIN_PASSWORD}`).toString('base64');
    await request(context.app).get('/api/questions').set('authorization', `Basic ${credentials}`).expect(200);
  });

  it('legt eine Show an und erlaubt den Kandidatenbeitritt erst nach Freigabe', async () => {
    const token = await moderatorToken();
    const created = await request(context.app)
      .post('/api/sessions')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Probeshow' })
      .expect(201);
    const code = created.body.code as string;

    // Beitritt ist standardmaessig gesperrt.
    await request(context.app)
      .post(`/api/public/sessions/${code}/join`)
      .send({ name: 'Alice', team: 'A' })
      .expect(403);

    // Oeffentliche Info ist erreichbar.
    const info = await request(context.app).get(`/api/public/sessions/${code}`).expect(200);
    expect(info.body.openJoin).toBe(false);
    expect(info.body.teams).toHaveLength(2);
  });
});
