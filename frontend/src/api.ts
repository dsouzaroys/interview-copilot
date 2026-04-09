import axios from 'axios';

const api = axios.create({
  baseURL: `http://${window.location.hostname}:3000`,
  timeout: 60000,
});

// Attach JWT from LocalStorage to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('interview_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface User {
  id: string;
  email: string;
  name: string;
}

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
  // ─── Auth ───────────────────────────────────────────────────────────────────
  login: async (payload: any) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', payload);
    localStorage.setItem('interview_token', data.token);
    localStorage.setItem('interview_user', JSON.stringify(data.user));
    return data;
  },

  register: async (payload: any) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/register', payload);
    localStorage.setItem('interview_token', data.token);
    localStorage.setItem('interview_user', JSON.stringify(data.user));
    return data;
  },

  logout: () => {
    localStorage.removeItem('interview_token');
    localStorage.removeItem('interview_user');
  },

  // ─── Sessions ───────────────────────────────────────────────────────────────
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

  getSessionHistory: async (sessionId: string) => {
    const { data } = await api.get<{ messages: Array<{ id: string; role: 'user' | 'agent'; content: string; timestamp: string }> }>(`/sessions/${sessionId}/history`);
    return data.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
  },

  endSession: async (sessionId: string) => {
    const { data } = await api.post<{ message: string; summary: SessionSummary }>(
      `/sessions/${sessionId}/end`
    );
    return data;
  },

  deleteSession: async (sessionId: string) => {
    const { data } = await api.delete(`/sessions/${sessionId}`);
    return data;
  },

  clearHistory: async () => {
    const { data } = await api.delete('/sessions');
    return data;
  },

  // ─── Code Execution ─────────────────────────────────────────────────────────
  submitCode: async (sessionId: string, payload: {
    questionId: string;
    code: string;
    language: string;
    testCases?: Array<{ input: string; expected_output: string }>;
  }) => {
    const { data } = await api.post<{
      success: boolean;
      all_passed?: boolean;
      summary?: string;
      test_results?: Array<{
        test_case: number;
        passed: boolean;
        input: string;
        expected_output: string;
        actual_output: string;
        error?: string;
      }>;
      output?: string;
      error?: string;
    }>(`/code/${sessionId}/execute`, payload);
    return data;
  },

  analyzeSolution: async (sessionId: string, payload: {
    questionId: string;
    questionText: string;
    submittedCode: string;
    language: string;
    testResults: string;
  }) => {
    const { data } = await api.post<{
      correctness: string;
      correctness_score: number;
      time_complexity: string;
      space_complexity: string;
      code_quality: string;
      strengths: string[];
      improvements: string[];
      feedback: string;
    }>(`/code/${sessionId}/analyze`, payload);
    return data;
  },
};
