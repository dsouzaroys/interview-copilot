import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 60000, // 60s — agent loops can take time
});

export interface Session {
  sessionId: string;
  interviewType: 'dsa' | 'backend' | 'system-design';
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'active' | 'completed' | 'abandoned';
  startedAt: string;
  totalQuestions: number;
  avgScore: number;
}

export interface SessionSummary {
  sessionId: string;
  totalQuestions: number;
  avgScore: number;
  scoreByTopic: Record<string, number>;
  weakAreas: string[];
  strongAreas: string[];
  scoreTrend: {
    scores: number[];
    movingAverage: number[];
    direction: 'improving' | 'declining' | 'stable';
  };
}

export const apiClient = {
  createSession: async (payload: {
    interviewType: 'dsa' | 'backend' | 'system-design';
    difficulty: 'easy' | 'medium' | 'hard';
  }) => {
    const { data } = await api.post<{ sessionId: string } & typeof payload>('/sessions', payload);
    return data;
  },

  sendMessage: async (sessionId: string, message: string) => {
    const { data } = await api.post<{
      sessionId: string;
      reply: string;
      meta: { toolsUsed: string[]; processingMs: number };
    }>(`/sessions/${sessionId}/message`, { message });
    return data;
  },

  getSessions: async () => {
    const { data } = await api.get<{ sessions: Session[] }>('/sessions');
    return data.sessions;
  },

  getSessionSummary: async (sessionId: string) => {
    const { data } = await api.get<SessionSummary>(`/sessions/${sessionId}/summary`);
    return data;
  },

  endSession: async (sessionId: string) => {
    const { data } = await api.post<{ message: string; summary: SessionSummary }>(
      `/sessions/${sessionId}/end`
    );
    return data;
  },
};
