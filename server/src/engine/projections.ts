import {
  MIN_APPROVED_QUESTIONS,
  TEAM_IDS,
  type AudienceView,
  type CandidateView,
  type FullQuestion,
  type InviteLinksView,
  type ModeratorView,
  type PublicQuestion,
  type QuestionRecord,
  type TeamId,
} from '@quiz/shared';
import type { GameEngine, Player } from './game.js';

/**
 * Rollenabhaengige Projektionen. Diese Funktionen sind die einzige Stelle, an
 * der Sichten fuer Clients erzeugt werden. Insbesondere wird die richtige
 * Antwort (correctIndex) nur dann herausgegeben, wenn die Phase 'revealed' ist
 * oder die Sicht fuer den Moderator bestimmt ist.
 */

export function publicQuestion(question: QuestionRecord): PublicQuestion {
  return {
    id: question.id,
    topic: question.topic,
    difficulty: question.difficulty,
    text: question.text,
    options: [...question.options],
  };
}

export function fullQuestion(question: QuestionRecord): FullQuestion {
  return {
    ...publicQuestion(question),
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    legalBasis: question.legalBasis,
    legalStatus: question.legalStatus,
    sourceNote: question.sourceNote,
    status: question.status,
  };
}

function jokerView(engine: GameEngine) {
  const counts = engine.pollCounts();
  return {
    active: engine.state.joker.active,
    forTeam: engine.state.joker.forTeam,
    hiddenOptions: [...engine.state.joker.hiddenOptions],
    aiHint: engine.state.joker.aiHint,
    poll: counts,
    pollTotal: counts.reduce((sum, n) => sum + n, 0),
  };
}

export function moderatorView(
  engine: GameEngine,
  options: { invites?: InviteLinksView } = {},
): ModeratorView {
  const state = engine.state;
  const reveal = state.reveal;
  return {
    role: 'moderator',
    sessionCode: state.code,
    sessionName: state.name,
    phase: state.phase,
    activeTeam: state.activeTeam,
    teams: {
      A: engine.teamView('A'),
      B: engine.teamView('B'),
    },
    currentQuestion: state.currentQuestion ? fullQuestion(state.currentQuestion) : null,
    answers: { A: engine.answerView('A'), B: engine.answerView('B') },
    countdown: engine.countdownView(),
    wheels: { A: engine.wheelView('A'), B: engine.wheelView('B') },
    joker: jokerView(engine),
    reveal: reveal ? { ...reveal } : null,
    log: state.log.slice(-40).map((entry) => ({ ...entry })),
    openJoin: state.openJoin,
    gameStarted: state.gameStarted,
    playableQuestions: engine.playableQuestionCount(),
    minQuestions: MIN_APPROVED_QUESTIONS,
    invites: options.invites ?? { candidatePath: '', audiencePath: '', version: state.inviteVersion },
    certificates: state.certificates.map((c) => ({
      id: c.id,
      playerName: c.playerName,
      team: c.team,
      level: c.level,
      issuedAt: c.issuedAt,
      disclaimer: CERTIFICATE_DISCLAIMER_TEXT,
    })),
    serverNow: Date.now(),
  };
}

export function candidateView(engine: GameEngine, player: Player): CandidateView {
  const state = engine.state;
  const question = state.currentQuestion;
  const answer = state.answers[player.team];
  const revealed = state.phase === 'revealed';
  const certificate = [...state.certificates].reverse().find((c) => c.playerName === player.name && c.team === player.team) ?? null;

  return {
    role: 'candidate',
    sessionCode: state.code,
    playerId: player.id,
    playerName: player.name,
    team: player.team,
    phase: state.phase,
    activeTeam: state.activeTeam,
    isDrawn: engine.isDrawn(player.id, player.team),
    isActive: state.activeTeam === player.team,
    gameStarted: state.gameStarted,
    // Fragen werden nur an das aktive Team uebertragen, und die richtige
    // Antwort niemals vor der Freigabe. Vor dem Spielstart gibt es keine Frage.
    question: question && state.gameStarted && state.activeTeam === player.team ? publicQuestion(question) : null,
    hiddenOptions: state.activeTeam === player.team ? [...state.joker.hiddenOptions] : [],
    yourAnswer: answer && answer.playerId === player.id ? answer.optionIndex : null,
    countdown: engine.countdownView(),
    teamState: engine.teamView(player.team),
    reveal: revealed && state.reveal ? { ...state.reveal } : null,
    certificate: certificate
      ? { ...certificate, disclaimer: CERTIFICATE_DISCLAIMER_TEXT }
      : null,
    serverNow: Date.now(),
  };
}

export function audienceView(engine: GameEngine, voterToken: string | null): AudienceView {
  const state = engine.state;
  const reveal = state.reveal;
  const yourVote = voterToken ? state.joker.votes.get(voterToken) ?? null : null;
  return {
    role: 'audience',
    sessionCode: state.code,
    phase: state.phase,
    activeTeam: state.activeTeam,
    teams: { A: engine.teamView('A'), B: engine.teamView('B') },
    gameStarted: state.gameStarted,
    // Publikum sieht den Fragetext, aber niemals die richtige Antwort vor der Freigabe.
    question: state.currentQuestion ? publicQuestion(state.currentQuestion) : null,
    countdown: engine.countdownView(),
    wheels: { A: engine.wheelView('A'), B: engine.wheelView('B') },
    joker: { ...jokerView(engine), yourVote },
    reveal: reveal ? { ...reveal } : null,
    serverNow: Date.now(),
  };
}

export const CERTIFICATE_DISCLAIMER_TEXT =
  '34A Quiz Arena - Leistungszertifikat. Kein amtlicher Nachweis der bestandenen Sachkundepruefung nach § 34a GewO.';

export { TEAM_IDS };
