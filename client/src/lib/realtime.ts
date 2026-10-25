import { io, type Socket } from 'socket.io-client';
import { C2S, S2C, type SessionView, type ServerErrorPayload } from '@quiz/shared';

export interface RealtimeOptions {
  onView: (view: SessionView) => void;
  onError?: (error: ServerErrorPayload) => void;
  onJoined?: (payload: { role: string; sessionCode: string }) => void;
}

/**
 * Duenne Huelle um Socket.IO. Der Client sendet ausschliesslich Absichten -
 * niemals Spielzustand. Bei Wiederverbindung wird automatisch neu beigetreten,
 * sodass der Server den vollstaendigen Zustand erneut zusendet.
 */
export class Realtime {
  private socket: Socket;
  private readonly joinEvent: string;
  private readonly joinPayload: Record<string, unknown>;
  private readonly options: RealtimeOptions;

  constructor(joinEvent: string, joinPayload: Record<string, unknown>, options: RealtimeOptions) {
    this.joinEvent = joinEvent;
    this.joinPayload = joinPayload;
    this.options = options;
    this.socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    this.socket.on('connect', () => this.socket.emit(this.joinEvent, this.joinPayload));
    this.socket.on(S2C.view, (view: SessionView) => this.options.onView(view));
    this.socket.on(S2C.joined, (payload: { role: string; sessionCode: string }) => this.options.onJoined?.(payload));
    this.socket.on(S2C.error, (payload: ServerErrorPayload) => this.options.onError?.(payload));
  }

  send(event: string, payload?: unknown): void {
    this.socket.emit(event, payload ?? {});
  }

  close(): void {
    this.socket.close();
  }

  static moderator(token: string, code: string | null, options: RealtimeOptions): Realtime {
    return code
      ? new Realtime(C2S.moderatorJoin, { token, code }, options)
      : new Realtime(C2S.moderatorCreate, { token }, options);
  }

  static candidate(ticket: string, options: RealtimeOptions): Realtime {
    return new Realtime(C2S.candidateJoin, { ticket }, options);
  }

  static audience(ticket: string, options: RealtimeOptions): Realtime {
    return new Realtime(C2S.audienceJoin, { ticket }, options);
  }
}

export { C2S };
