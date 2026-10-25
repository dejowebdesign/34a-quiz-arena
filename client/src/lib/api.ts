/** Zugriff auf die REST-API. Moderatorenzugang wird als Bearer-Token gehalten. */

const TOKEN_KEY = 'quiz34a.moderatorToken';

export function getModeratorToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setModeratorToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (authenticated) {
    const token = getModeratorToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const payload = data as { message?: string; details?: string[] };
    throw new ApiError(response.status, payload.message ?? `HTTP ${response.status}`, payload.details ?? []);
  }
  return data as T;
}

export interface MetaResponse {
  topics: { id: string; label: string }[];
  difficulties: { id: string; label: string }[];
  questionStatuses: { id: string; label: string }[];
  legalStatuses: { id: string; label: string }[];
  certificateDisclaimer: string;
}

export interface QuestionPayload {
  topic: string;
  difficulty: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  legalBasis: string | null;
  legalStatus: string;
  sourceNote: string | null;
  status: string;
}

export interface QuestionDto extends QuestionPayload {
  id: number;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  meta: () => request<MetaResponse>('/meta'),
  health: () => request<{ status: string; approvedQuestions: number }>('/health'),

  login: (user: string, password: string) =>
    request<{ token: string }>('/auth/moderator', { method: 'POST', body: JSON.stringify({ user, password }) }),

  createSession: (name: string) =>
    request<{ code: string; name: string }>('/sessions', { method: 'POST', body: JSON.stringify({ name }) }, true),

  listSessions: () => request<{ codes: string[] }>('/sessions', {}, true),

  registerPlayer: (code: string, name: string, team: 'A' | 'B') =>
    request<{ playerId: string; token: string; team: 'A' | 'B'; sessionCode: string }>(
      `/sessions/${code}/players`,
      { method: 'POST', body: JSON.stringify({ name, team }) },
      true,
    ),

  removePlayer: (code: string, playerId: string) =>
    request<void>(`/sessions/${code}/players/${playerId}`, { method: 'DELETE' }, true),

  audienceToken: (code: string) => request<{ token: string }>(`/sessions/${code}/audience-token`, { method: 'POST' }, true),

  listQuestions: (params: { status?: string; topic?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.topic) search.set('topic', params.topic);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return request<{ questions: QuestionDto[] }>(`/questions${suffix}`, {}, true);
  },

  createQuestion: (payload: QuestionPayload) =>
    request<{ question: QuestionDto }>('/questions', { method: 'POST', body: JSON.stringify(payload) }, true),

  updateQuestion: (id: number, payload: QuestionPayload) =>
    request<{ question: QuestionDto }>(`/questions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, true),

  setQuestionStatus: (id: number, status: string) =>
    request<{ question: QuestionDto }>(`/questions/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }, true),

  deleteQuestion: (id: number) => request<void>(`/questions/${id}`, { method: 'DELETE' }, true),

  importQuestions: (questions: unknown[]) =>
    request<{ imported: number; failed: number; errors: { index: number; message: string }[] }>(
      '/questions/import',
      { method: 'POST', body: JSON.stringify({ questions }) },
      true,
    ),
};
