import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { C2S, S2C, type AudienceView, type CandidateView, type ModeratorView } from '@quiz/shared';

const ADMIN_PASSWORD = 'einladungs-passwort';

function makeConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    ADMIN_PASSWORD,
    SESSION_SECRET: 'einladungs-secret-einladungs-secret',
    PORT: '0',
  } as NodeJS.ProcessEnv);
}

function connect(url: string): Socket {
  return ioClient(url, { transports: ['websocket'], reconnection: false, forceNew: true });
}

function nextView<T>(socket: Socket, predicate: (view: unknown) => boolean, timeoutMs = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(S2C.view, handler);
      reject(new Error('Zeitueberschreitung beim Warten auf Sicht.'));
    }, timeoutMs);
    const handler = (view: unknown) => {
      if (!predicate(view)) return;
      clearTimeout(timer);
      socket.off(S2C.view, handler);
      resolve(view as T);
    };
    socket.on(S2C.view, handler);
  });
}

function nextError(socket: Socket, timeoutMs = 4_000): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitueberschreitung beim Warten auf Fehler.')), timeoutMs);
    socket.once(S2C.error, (payload: { code: string }) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Teilnehmer- und Publikumszugang ueber Einladungslinks', () => {
  let context: AppContext;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    context = createApp({ config: makeConfig(), dbPath: ':memory:', clientDist: null });
    await new Promise<void>((resolve) => context.server.listen(0, resolve));
    const address = context.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    await context.close();
  });

  /** Moderator anmelden, Show anlegen und `count` freigegebene Fragen erzeugen. */
  async function prepare(count = 15) {
    const login = await request(context.app)
      .post('/api/auth/moderator')
      .send({ user: 'moderator', password: ADMIN_PASSWORD })
      .expect(200);
    const token = login.body.token as string;

    const created = await request(context.app)
      .post('/api/sessions')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Einladungsshow' })
      .expect(201);
    const code = created.body.code as string;

    for (let i = 0; i < count; i += 1) {
      await request(context.app)
        .post('/api/questions')
        .set('authorization', `Bearer ${token}`)
        .send({
          topic: 'straf_verfahrensrecht',
          difficulty: 'mittel',
          text: `Testfrage ${i + 1}`,
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: 'Erklaerung',
          legalBasis: '§ 34a GewO',
          legalStatus: 'unverified',
          sourceNote: null,
          status: 'approved',
        })
        .expect(201);
    }

    return { token, code };
  }

  it('weist den Showstart mit 14 Fragen ab und erlaubt ihn mit 15', async () => {
    // 14 Fragen: Start muss abgelehnt werden.
    const fourteen = await prepare(14);
    const rejected = await request(context.app)
      .post(`/api/sessions/${fourteen.code}/start`)
      .set('authorization', `Bearer ${fourteen.token}`)
      .expect(409);
    expect(rejected.body.code).toBe('not_enough_questions');
    expect(rejected.body.playableQuestions).toBe(14);
    expect(rejected.body.minQuestions).toBe(15);

    // Die 15. Frage fehlt noch: Start weiterhin abgelehnt.
    await request(context.app)
      .post('/api/questions')
      .set('authorization', `Bearer ${fourteen.token}`)
      .send({
        topic: 'straf_verfahrensrecht',
        difficulty: 'mittel',
        text: 'Testfrage 15',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Erklaerung',
        legalBasis: '§ 34a GewO',
        legalStatus: 'unverified',
        sourceNote: null,
        status: 'approved',
      })
      .expect(201);
    const accepted = await request(context.app)
      .post(`/api/sessions/${fourteen.code}/start`)
      .set('authorization', `Bearer ${fourteen.token}`)
      .expect(200);
    expect(accepted.body.started).toBe(true);
    expect(accepted.body.playableQuestions).toBe(15);
  });

  it('zaehlt nicht freigegebene Fragen nicht mit', async () => {
    const { token, code } = await prepare(15);
    // Eine zusaetzliche, aber nur entworfene Frage darf nicht zaehlen.
    await request(context.app)
      .post('/api/questions')
      .set('authorization', `Bearer ${token}`)
      .send({
        topic: 'straf_verfahrensrecht',
        difficulty: 'mittel',
        text: 'Entwurf',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 0,
        explanation: 'Erklaerung',
        legalBasis: '§ 34a GewO',
        legalStatus: 'unverified',
        sourceNote: null,
        status: 'draft',
      })
      .expect(201);
    const started = await request(context.app)
      .post(`/api/sessions/${code}/start`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(started.body.playableQuestions).toBe(15);
  });

  it('liefert Einladungspfade, die Teilnehmer ohne PIN zu einer eigenen Sicht fuehren', async () => {
    const { token, code } = await prepare(15);
    await request(context.app)
      .post(`/api/sessions/${code}/start`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const invites = await request(context.app)
      .get(`/api/public/sessions/${code}/invites`)
      .expect(200);
    expect(invites.body.candidatePath).toMatch(/^#\/c\//);
    expect(invites.body.audiencePath).toMatch(/^#\/a\//);

    // Kandidatenpass pruefen: liefert Show, aber keine Moderationsrechte.
    const candidatePass = invites.body.candidatePath.replace('#/c/', '');
    const info = await request(context.app).get(`/api/public/invite/${candidatePass}`).expect(200);
    expect(info.body.sessionCode).toBe(code);

    // Beitritt ohne Show-Code und ohne PIN.
    const joined = await request(context.app)
      .post(`/api/public/join/${candidatePass}`)
      .send({ name: 'Dana', team: 'A' })
      .expect(201);
    expect(joined.body.team).toBe('A');
    expect(typeof joined.body.token).toBe('string');

    // Der Kandidat landet in der Kandidatensicht, nicht in der Moderation.
    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: joined.body.token });
    const view = await nextView<CandidateView>(candidate, (v) => (v as CandidateView).role === 'candidate');
    expect(view.playerName).toBe('Dana');
    expect(view.role).toBe('candidate');
  });

  it('fuehrt einen Publikumslink direkt zur Publikumsansicht ohne Show-Code', async () => {
    const { token, code } = await prepare(15);
    await request(context.app)
      .post(`/api/sessions/${code}/start`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const invites = await request(context.app).get(`/api/public/sessions/${code}/invites`).expect(200);
    const audiencePass = invites.body.audiencePath.replace('#/a/', '');

    const device = await request(context.app).post(`/api/public/audience/${audiencePass}`).expect(200);
    expect(device.body.sessionCode).toBe(code);

    const audience = connect(baseUrl);
    sockets.push(audience);
    audience.emit(C2S.audienceJoin, { ticket: device.body.token });
    const view = await nextView<AudienceView>(audience, (v) => (v as AudienceView).role === 'audience');
    expect(view.role).toBe('audience');
    expect(view.sessionCode).toBe(code);
  });

  it('weist ungueltige und widerrufene Einladungen verstaendlich ab', async () => {
    const { token, code } = await prepare(15);

    // Manipulierter Pass: kein Zugriff.
    await request(context.app).get('/api/public/invite/gefaelschter-pass').expect(404);
    await request(context.app).post('/api/public/join/gefaelschter-pass').send({ name: 'X', team: 'A' }).expect(404);
    await request(context.app).post('/api/public/audience/gefaelschter-pass').expect(404);

    // Ein Publikumspass darf niemals einen Kandidatenbeitritt erlauben.
    const invites = await request(context.app).get(`/api/public/sessions/${code}/invites`).expect(200);
    const audiencePass = invites.body.audiencePath.replace('#/a/', '');
    await request(context.app).post(`/api/public/join/${audiencePass}`).send({ name: 'X', team: 'A' }).expect(404);

    // Widerruf: bisherige Links sind danach ungueltig.
    const candidatePass = invites.body.candidatePath.replace('#/c/', '');
    await request(context.app).get(`/api/public/invite/${candidatePass}`).expect(200);
    await request(context.app)
      .post(`/api/sessions/${code}/invites/rotate`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    await request(context.app).get(`/api/public/invite/${candidatePass}`).expect(404);
  });

  it('behaelt die Beitrittssperre fuer den Code-Weg ohne Einladungslink', async () => {
    // Der Ersatzweg ueber den Show-Code unterliegt weiterhin der Freigabe durch
    // die Moderation; der signierte Einladungslink ist davon unabhaengig.
    const { code } = await prepare(15);
    const blocked = await request(context.app)
      .post(`/api/public/sessions/${code}/join`)
      .send({ name: 'Eva', team: 'B' })
      .expect(403);
    expect(blocked.body.code).toBe('join_closed');
  });

  it('gibt einem Teilnehmerlink niemals Moderatorenrechte', async () => {
    const { token, code } = await prepare(15);
    await request(context.app)
      .post(`/api/sessions/${code}/start`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const invites = await request(context.app).get(`/api/public/sessions/${code}/invites`).expect(200);
    const candidatePass = invites.body.candidatePath.replace('#/c/', '');
    const joined = await request(context.app)
      .post(`/api/public/join/${candidatePass}`)
      .send({ name: 'Frank', team: 'A' })
      .expect(201);

    // Der Kandidat versucht eine geschuetzte Moderationsaktion.
    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: joined.body.token });
    await nextView<CandidateView>(candidate, (v) => (v as CandidateView).role === 'candidate');
    const forbidden = nextError(candidate);
    candidate.emit(C2S.startQuestion, { questionId: 1 });
    expect((await forbidden).code).toBe('forbidden');
  });

  it('schuetzt die Moderatorenansicht vor Teilnehmern', async () => {
    const { token, code } = await prepare(15);
    const invites = await request(context.app).get(`/api/public/sessions/${code}/invites`).expect(200);
    const candidatePass = invites.body.candidatePath.replace('#/c/', '');
    const joined = await request(context.app)
      .post(`/api/public/join/${candidatePass}`)
      .send({ name: 'Gina', team: 'B' })
      .expect(201);

    // Ein Kandidatenticket ist kein Moderatorticket.
    const intruder = connect(baseUrl);
    sockets.push(intruder);
    const denied = nextError(intruder);
    intruder.emit(C2S.moderatorJoin, { token: joined.body.token, code });
    expect((await denied).code).toBe('unauthorized');

    // Ein Publikumsticket ebenso wenig.
    const audiencePass = invites.body.audiencePath.replace('#/a/', '');
    const device = await request(context.app).post(`/api/public/audience/${audiencePass}`).expect(200);
    const audienceIntruder = connect(baseUrl);
    sockets.push(audienceIntruder);
    const denied2 = nextError(audienceIntruder);
    audienceIntruder.emit(C2S.moderatorJoin, { token: device.body.token, code });
    expect((await denied2).code).toBe('unauthorized');
  });

  it('laesst Publikum nur bei aktivem Publikumsjoker abstimmen und verhindert Mehrfachstimmen', async () => {
    const { token, code } = await prepare(15);
    await request(context.app)
      .post(`/api/sessions/${code}/start`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const playerA = await request(context.app)
      .post(`/api/sessions/${code}/players`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Alice', team: 'A' })
      .expect(201);
    const invites = await request(context.app).get(`/api/public/sessions/${code}/invites`).expect(200);
    const audiencePass = invites.body.audiencePath.replace('#/a/', '');
    const device = await request(context.app).post(`/api/public/audience/${audiencePass}`).expect(200);

    const moderator = connect(baseUrl);
    sockets.push(moderator);
    moderator.emit(C2S.moderatorJoin, { token, code });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).role === 'moderator');

    const audience = connect(baseUrl);
    sockets.push(audience);
    audience.emit(C2S.audienceJoin, { ticket: device.body.token });
    await nextView<AudienceView>(audience, (v) => (v as AudienceView).role === 'audience');

    // Ohne aktiven Joker: Stimme wird abgelehnt.
    const notActive = nextError(audience);
    audience.emit(C2S.audienceVote, { optionIndex: 0 });
    expect((await notActive).code).toBe('no_poll');

    // Kandidat fuer Team A ziehen, Frage starten, Publikumsjoker aktivieren.
    moderator.emit(C2S.spinWheel, { team: 'A' });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).wheels.A.lastDrawn !== null);
    const questionId = (await request(context.app).get('/api/questions?status=approved').set('authorization', `Bearer ${token}`)).body
      .questions[0].id as number;
    moderator.emit(C2S.startQuestion, { questionId });
    await nextView<AudienceView>(audience, (v) => (v as AudienceView).question !== null);

    moderator.emit(C2S.activateJoker, { type: 'audience', team: 'A' });
    await nextView<AudienceView>(audience, (v) => (v as AudienceView).joker.active === 'audience');

    audience.emit(C2S.audienceVote, { optionIndex: 1 });
    const voted = await nextView<AudienceView>(audience, (v) => (v as AudienceView).joker.yourVote === 1);
    expect(voted.joker.pollTotal).toBe(1);

    // Zweite Stimme desselben Geraets wird abgewiesen.
    const duplicate = nextError(audience);
    audience.emit(C2S.audienceVote, { optionIndex: 2 });
    expect((await duplicate).code).toBe('already_voted');

    expect(playerA.body.playerId).toBeTruthy();
  });
});
