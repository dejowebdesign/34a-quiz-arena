import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { C2S, S2C, type CandidateView, type ModeratorView } from '@quiz/shared';

const ADMIN_PASSWORD = 'integration-passwort';

function makeConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    ADMIN_PASSWORD,
    SESSION_SECRET: 'integration-secret-integration-secret',
    PORT: '0',
  } as NodeJS.ProcessEnv);
}

/** Wartet auf das naechste `session:view`, das die Bedingung erfuellt. */
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

function connect(url: string): Socket {
  return ioClient(url, { transports: ['websocket'], reconnection: false, forceNew: true });
}

describe('Echtzeit-Integration ueber Socket.IO', () => {
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

  async function prepare() {
    const login = await request(context.app)
      .post('/api/auth/moderator')
      .send({ user: 'moderator', password: ADMIN_PASSWORD })
      .expect(200);
    const token = login.body.token as string;

    const created = await request(context.app)
      .post('/api/sessions')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Integrationsshow' })
      .expect(201);
    const code = created.body.code as string;

    // Eine Frage anlegen und freigeben.
    const question = {
      topic: 'oeffentliches_recht_gewerberecht',
      difficulty: 'leicht',
      text: 'Wer erteilt die Erlaubnis nach § 34a GewO?',
      options: ['Die Gemeinde', 'Das Finanzamt', 'Die Polizei', 'Das Gewerbeamt des Bundes'],
      correctIndex: 0,
      explanation: 'Die Erlaubnis erteilt die zustaendige Behoerde.',
      legalBasis: '§ 34a GewO',
      legalStatus: 'unverified',
      sourceNote: 'Gesetzestext, Stand 2024',
      status: 'approved',
    };
    const created2 = await request(context.app)
      .post('/api/questions')
      .set('authorization', `Bearer ${token}`)
      .send(question)
      .expect(201);
    const questionId = created2.body.question.id as number;

    // Zwei Kandidaten (je Team) und ein Publikumsteilnehmer.
    const playerA = await request(context.app)
      .post(`/api/sessions/${code}/players`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Alice', team: 'A' })
      .expect(201);
    const playerB = await request(context.app)
      .post(`/api/sessions/${code}/players`)
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Bob', team: 'B' })
      .expect(201);
    const audience = await request(context.app)
      .post(`/api/sessions/${code}/audience-token`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    return {
      token,
      code,
      questionId,
      playerA: playerA.body as { playerId: string; token: string },
      playerB: playerB.body as { playerId: string; token: string },
      audienceTicket: audience.body.token as string,
    };
  }

  it('uebertraegt die richtige Antwort nicht an den Kandidaten und erst nach Freigabe an das Publikum', async () => {
    const ctx = await prepare();

    const moderator = connect(baseUrl);
    sockets.push(moderator);
    moderator.emit(C2S.moderatorJoin, { token: ctx.token, code: ctx.code });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).role === 'moderator');

    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: ctx.playerA.token });
    const candidateInitial = await nextView<CandidateView>(candidate, (v) => (v as CandidateView).role === 'candidate');
    expect(candidateInitial.playerName).toBe('Alice');

    const audience = connect(baseUrl);
    sockets.push(audience);
    audience.emit(C2S.audienceJoin, { ticket: ctx.audienceTicket });
    await nextView(audience, (v) => (v as { role: string }).role === 'audience');

    // Gluecksrad drehen (Team A) und Frage starten.
    moderator.emit(C2S.spinWheel, { team: 'A' });
    const wheelView = await nextView<ModeratorView>(
      moderator,
      (v) => (v as ModeratorView).wheels.A.lastDrawn !== null,
    );
    expect(wheelView.wheels.A.lastDrawnName).toBe('Alice');

    const questionPromise = nextView<CandidateView>(candidate, (v) => (v as CandidateView).question !== null);
    moderator.emit(C2S.startQuestion, { questionId: ctx.questionId });
    const withQuestion = await questionPromise;

    // Kandidat sieht die Frage, aber kein correctIndex-Feld.
    expect(withQuestion.question?.text).toContain('§ 34a GewO');
    expect(Object.keys(withQuestion.question ?? {})).not.toContain('correctIndex');
    expect(withQuestion.reveal).toBeNull();
    expect(withQuestion.isDrawn).toBe(true);

    // Kandidat antwortet verbindlich.
    candidate.emit(C2S.answer, { optionIndex: 0 });
    const answered = await nextView<ModeratorView>(
      moderator,
      (v) => (v as ModeratorView).answers.A !== null,
    );
    expect(answered.answers.A?.playerName).toBe('Alice');
    expect(answered.answers.A?.optionIndex).toBe(0);

    // Vor der Freigabe: kein reveal beim Kandidaten.
    const beforeReveal = await new Promise<CandidateView>((resolve) => {
      setTimeout(() => resolve(withQuestion), 250);
    });
    expect(beforeReveal.reveal).toBeNull();

    // Freigabe durch die Moderation.
    const revealedPromise = nextView<CandidateView>(candidate, (v) => (v as CandidateView).reveal !== null);
    moderator.emit(C2S.reveal);
    const revealed = await revealedPromise;
    expect(revealed.reveal?.correctIndex).toBe(0);
    expect(revealed.reveal?.outcome).toBe('correct');
    expect(revealed.reveal?.levelAfter).toBe(1);
  });

  it('stellt den Spielzustand nach einer Wiederverbindung wieder her', async () => {
    const ctx = await prepare();

    const moderator = connect(baseUrl);
    sockets.push(moderator);
    moderator.emit(C2S.moderatorJoin, { token: ctx.token, code: ctx.code });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).role === 'moderator');

    moderator.emit(C2S.spinWheel, { team: 'A' });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).wheels.A.lastDrawn !== null);
    moderator.emit(C2S.startQuestion, { questionId: ctx.questionId });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).currentQuestion !== null);

    // Kandidat verbindet sich, antwortet, dann Verbindung trennen.
    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: ctx.playerA.token });
    await nextView<CandidateView>(candidate, (v) => (v as CandidateView).question !== null);
    candidate.emit(C2S.answer, { optionIndex: 0 });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).answers.A !== null);
    candidate.close();

    // Neue Verbindung mit demselben Ticket: der Zustand muss vollstaendig sein.
    const reconnected = connect(baseUrl);
    sockets.push(reconnected);
    reconnected.emit(C2S.candidateJoin, { ticket: ctx.playerA.token });
    const restored = await nextView<CandidateView>(
      reconnected,
      (v) => (v as CandidateView).question !== null,
    );
    expect(restored.playerName).toBe('Alice');
    expect(restored.isDrawn).toBe(true);
    expect(restored.yourAnswer).toBe(0);
    expect(restored.teamState.jokers.fifty).toBe('available');
  });

  it('weist ungueltige Tickets und unberechtigte Aktionen ab', async () => {
    const ctx = await prepare();

    const intruder = connect(baseUrl);
    sockets.push(intruder);
    const errorPromise = new Promise<{ code: string }>((resolve) => {
      intruder.on(S2C.error, (payload: { code: string }) => resolve(payload));
    });
    intruder.emit(C2S.candidateJoin, { ticket: 'gefaelschtes-ticket' });
    const error = await errorPromise;
    expect(error.code).toBe('unauthorized');

    // Kandidat darf keine Moderationsaktion senden.
    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: ctx.playerA.token });
    await nextView<CandidateView>(candidate, (v) => (v as CandidateView).role === 'candidate');
    const forbiddenPromise = new Promise<{ code: string }>((resolve) => {
      candidate.on(S2C.error, (payload: { code: string }) => resolve(payload));
    });
    candidate.emit(C2S.reveal);
    const forbidden = await forbiddenPromise;
    expect(forbidden.code).toBe('forbidden');
  });

  it('verhindert doppelte Antworten und mehrfache Jokeraktivierung', async () => {
    const ctx = await prepare();

    const moderator = connect(baseUrl);
    sockets.push(moderator);
    moderator.emit(C2S.moderatorJoin, { token: ctx.token, code: ctx.code });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).role === 'moderator');

    const candidate = connect(baseUrl);
    sockets.push(candidate);
    candidate.emit(C2S.candidateJoin, { ticket: ctx.playerA.token });
    await nextView<CandidateView>(candidate, (v) => (v as CandidateView).role === 'candidate');

    moderator.emit(C2S.spinWheel, { team: 'A' });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).wheels.A.lastDrawn !== null);
    moderator.emit(C2S.startQuestion, { questionId: ctx.questionId });
    await nextView<CandidateView>(candidate, (v) => (v as CandidateView).question !== null);

    const errors: string[] = [];
    candidate.on(S2C.error, (payload: { code: string }) => errors.push(payload.code));

    candidate.emit(C2S.answer, { optionIndex: 0 });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).answers.A !== null);
    candidate.emit(C2S.answer, { optionIndex: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(errors).toContain('already_answered');

    // 50:50 einmal einsetzen, danach erneut versuchen.
    const jokerErrors: string[] = [];
    moderator.on(S2C.error, (payload: { code: string }) => jokerErrors.push(payload.code));
    moderator.emit(C2S.activateJoker, { type: 'fifty', team: 'A' });
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).joker.active === 'fifty');
    moderator.emit(C2S.closeJoker);
    await nextView<ModeratorView>(moderator, (v) => (v as ModeratorView).joker.active === null);
    moderator.emit(C2S.activateJoker, { type: 'fifty', team: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(jokerErrors).toContain('joker_used');
  });
});
