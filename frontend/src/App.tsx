import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { apiClient } from './api';
import type { Session, SessionSummary, User } from './api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

type View = 'chat' | 'analytics';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const typeLabel: Record<string, string> = {
  dsa: 'DSA',
  backend: 'Backend',
  'system-design': 'System Design',
};

const typeIcon: Record<string, string> = {
  dsa: '⚡',
  backend: '🖥️',
  'system-design': '🏗️',
};

const difficultyIcon: Record<string, string> = {
  easy: '🟢',
  medium: '🟡',
  hard: '🔴',
};

function formatMessage(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('📊')) {
      return <div key={i} className="score-line">{line}</div>;
    }
    const parts = line.split(/\*\*(.*?)\*\*/g);
    const rendered = parts.map((part, j) =>
      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
    );
    return <p key={i}>{rendered}</p>;
  });
}

// ─── Auth View ────────────────────────────────────────────────────────────────

function AuthView({ onLogin }: { onLogin: (user: User) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isLogin) {
        const res = await apiClient.login({ email, password });
        onLogin(res.user);
      } else {
        const res = await apiClient.register({ email, password, name });
        onLogin(res.user);
      }
    } catch (err: any) {
      const resp = err.response?.data;
      if (resp?.details?.fieldErrors) {
        const firstField = Object.keys(resp.details.fieldErrors)[0];
        const msg = resp.details.fieldErrors[firstField][0];
        setError(`${firstField}: ${msg}`);
      } else {
        setError(resp?.error || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">🧠 AI Interview Copilot</h1>
        <p className="auth-subtitle">
          {isLogin ? 'Welcome back! Sign in to continue.' : 'Create an account to start practicing.'}
        </p>

        {error && <div className="toast" style={{ position: 'static', marginBottom: '20px' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="auth-input-group">
              <label className="form-label">Full Name</label>
              <input
                className="auth-input"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="auth-input-group">
            <label className="form-label">Email Address</label>
            <input
              className="auth-input"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="auth-input-group">
            <label className="form-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {!isLogin && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>Minimum 6 characters required.</p>}
          </div>

          <button className="auth-action-btn" type="submit" disabled={loading}>
            {loading ? '⏳ Please wait...' : isLogin ? 'Sign In →' : 'Create Account →'}
          </button>
        </form>

        <div className="auth-switch">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}
          <button className="auth-switch-btn" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? 'Sign Up' : 'Log In'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Session Modal ────────────────────────────────────────────────────────

function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (sessionId: string, type: string, difficulty: string) => void;
}) {
  const [type, setType] = useState<'dsa' | 'backend' | 'system-design'>('backend');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const data = await apiClient.createSession({ interviewType: type, difficulty });
      onCreate(data.sessionId, type, difficulty);
    } catch {
      alert('Failed to create session. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">🎯 Start New Interview</h2>
        <p className="modal-sub">Choose your interview type and difficulty level.</p>

        <div className="form-group">
          <label className="form-label">Interview Type</label>
          <div className="option-grid">
            {(['dsa', 'backend', 'system-design'] as const).map((t) => (
              <button
                key={t}
                className={`option-btn ${type === t ? 'selected' : ''}`}
                onClick={() => setType(t)}
              >
                <span className="option-btn-icon">{typeIcon[t]}</span>
                <div className="option-btn-label">{typeLabel[t]}</div>
                <div className="option-btn-desc">
                  {t === 'dsa' && 'Algorithms'}
                  {t === 'backend' && 'APIs & DB'}
                  {t === 'system-design' && 'Architecture'}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Difficulty</label>
          <div className="option-grid">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <button
                key={d}
                className={`option-btn ${difficulty === d ? 'selected' : ''}`}
                onClick={() => setDifficulty(d)}
              >
                <span className="option-btn-icon">{difficultyIcon[d]}</span>
                <div className="option-btn-label" style={{ textTransform: 'capitalize' }}>{d}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-start" onClick={handleCreate} disabled={loading}>
            {loading ? '⏳ Creating...' : `Start ${typeLabel[type]} Interview →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics Panel ──────────────────────────────────────────────────────────

function Analytics({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiClient.getSessionSummary(sessionId)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="dashboard" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading analytics...</div>
      </div>
    );
  }

  if (!summary) return null;

  const chartData = summary.scoreTrend.scores.map((score, i) => ({
    q: `Q${i + 1}`,
    score,
    avg: summary.scoreTrend.movingAverage[i],
  }));

  const topicEntries = Object.entries(summary.scoreByTopic).sort((a, b) => a[1] - b[1]);

  const directionIcon = { improving: '📈', declining: '📉', stable: '➡️' };

  return (
    <div className="dashboard">
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-card-label">Avg Score</div>
          <div className="stat-card-value">{summary.avgScore.toFixed(1)}</div>
          <div className="stat-card-sub">out of 10</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Questions</div>
          <div className="stat-card-value">{summary.totalQuestions}</div>
          <div className="stat-card-sub">answered</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Weak Areas</div>
          <div className="stat-card-value">{summary.weakAreas.length}</div>
          <div className="stat-card-sub">need focus</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Trend</div>
          <div className="stat-card-value" style={{ fontSize: '1.5rem' }}>
            {directionIcon[summary.scoreTrend.direction]}
          </div>
          <div className="stat-card-sub" style={{ textTransform: 'capitalize' }}>
            {summary.scoreTrend.direction}
          </div>
        </div>
      </div>

      <div className="dashboard-row">
        <div className="panel">
          <div className="panel-title">📊 Score Timeline</div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="q" tick={{ fontSize: 11, fill: '#8b8fa8' }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#8b8fa8' }} />
                <Tooltip
                  contentStyle={{ background: '#1a1d26', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f5' }}
                />
                <ReferenceLine y={6} stroke="rgba(251,191,36,0.4)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="score" stroke="#6c63ff" strokeWidth={2} dot={{ fill: '#6c63ff', r: 4 }} />
                <Line type="monotone" dataKey="avg" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '20px 0' }}>
              Answer questions to see your score trend 📈
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">🎯 Topic Performance</div>
          {topicEntries.length > 0 ? (
            <div className="topics-list">
              {topicEntries.map(([topic, score]) => (
                <div key={topic} className="topic-row">
                  <div className="topic-name">{topic}</div>
                  <div className="topic-bar-bg">
                    <div
                      className={`topic-bar ${score < 6 ? 'weak' : 'strong'}`}
                      style={{ width: `${score * 10}%` }}
                    />
                  </div>
                  <div
                    className="topic-score"
                    style={{ color: score < 6 ? 'var(--danger)' : 'var(--success)' }}
                  >
                    {score.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Topics will appear as you answer questions.
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-row">
        <div className="panel">
          <div className="panel-title">🔴 Areas to Improve</div>
          {summary.weakAreas.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {summary.weakAreas.map((area) => (
                <span key={area} className="chip weak">{area}</span>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No weak areas detected yet 🎉
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">🟢 Strong Areas</div>
          {summary.strongAreas.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {summary.strongAreas.map((area) => (
                <span key={area} className="chip strong">{area}</span>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Keep practicing to identify your strengths!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Chat View ────────────────────────────────────────────────────────────────

function ChatView({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'agent',
          content: `Hello! I'm your AI interviewer for today's **${typeLabel[session.interviewType]}** session at **${session.difficulty}** difficulty.\n\nType **"I'm ready"** or **"Let's start"** to begin your interview!`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [session.sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await apiClient.sendMessage(session.sessionId, text);
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: response.reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: '⚠️ Failed to get response. Please check the server and try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, loading, session.sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-info">
          <span className={`chat-type-badge ${session.interviewType}`}>
            {typeIcon[session.interviewType]} {typeLabel[session.interviewType]}
          </span>
          <span className="chat-stat">
            {difficultyIcon[session.difficulty]} {session.difficulty}
          </span>
          {session.avgScore > 0 && (
            <span className="chat-stat">📊 Avg: {session.avgScore.toFixed(1)}/10</span>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'agent' ? '🤖' : '👤'}
            </div>
            <div className="message-bubble">
              {formatMessage(msg.content)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="typing-indicator">
            <div className="message-avatar" style={{ background: 'linear-gradient(135deg,#6c63ff,#a78bfa)', borderRadius: 10, width: 36, height: 36, display:'flex', alignItems:'center', justifyContent:'center' }}>
              🤖
            </div>
            <div className="typing-dots">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-form">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder="Type your answer..."
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button className="chat-send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
            {loading ? '⏳' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('interview_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>('chat');
  const [showModal, setShowModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (user) {
      apiClient.getSessions().then(setSessions).catch(console.error);
    }
  }, [user]);

  const handleLogin = (u: User) => {
    setUser(u);
  };

  const handleLogout = () => {
    apiClient.logout();
    setUser(null);
    setSessions([]);
    setActiveSession(null);
  };

  const handleSessionCreated = (sessionId: string, type: string, difficulty: string) => {
    const newSession: Session = {
      sessionId,
      interviewType: type as Session['interviewType'],
      difficulty: difficulty as Session['difficulty'],
      status: 'active',
      startedAt: new Date().toISOString(),
      totalQuestions: 0,
      avgScore: 0,
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSession(newSession);
    setView('chat');
    setShowModal(false);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this interview session?')) return;
    try {
      await apiClient.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.sessionId !== id));
      if (activeSession?.sessionId === id) setActiveSession(null);
    } catch {
      alert('Failed to delete session');
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Are you sure you want to clear ALL interview history? This cannot be undone.')) return;
    try {
      await apiClient.clearHistory();
      setSessions([]);
      setActiveSession(null);
    } catch {
      alert('Failed to clear history');
    }
  };

  if (!user) {
    return <AuthView onLogin={handleLogin} />;
  }

  return (
    <div className={`app-shell ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <header className="topbar">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          {isSidebarOpen ? '✕' : '☰'}
        </button>
        <div className="topbar-brand">
          <div className="brain-icon">🧠</div>
          <span className="brand-text">AI Interview <span className="copilot">Copilot</span></span>
        </div>

        {activeSession && (
          <nav className="topbar-nav">
            <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
              💬 Interview
            </button>
            <button className={view === 'analytics' ? 'active' : ''} onClick={() => setView('analytics')}>
              📊 Analytics
            </button>
          </nav>
        )}

        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="user-name">{user.name}</span>
          <div className="user-avatar">
            👤
          </div>
        </div>
      </header>

      {/* Mobile Floating Navigation — Only visible on mobile via CSS */}
      {activeSession && (
        <nav className="mobile-floating-nav">
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
            💬 Interview
          </button>
          <button className={view === 'analytics' ? 'active' : ''} onClick={() => setView('analytics')}>
            📊 Analytics
          </button>
        </nav>
      )}

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}

      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title">Sessions</div>
          <button className="btn-new-session" onClick={() => { setShowModal(true); setIsSidebarOpen(false); }}>
            <span>+</span> New Interview
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 && (
            <div style={{ padding: '20px 12px', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
              No sessions yet.<br />Start your first interview!
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className={`session-item ${activeSession?.sessionId === s.sessionId ? 'active' : ''}`}
              onClick={() => { setActiveSession(s); setView('chat'); setIsSidebarOpen(false); }}
            >
              <div className="session-item-content">
                <div className={`session-item-label ${s.interviewType}`}>
                  {typeIcon[s.interviewType]} {typeLabel[s.interviewType]}
                </div>
                <div className="session-item-meta">
                  <span>{difficultyIcon[s.difficulty]} {s.difficulty}</span>
                  {s.avgScore > 0 && <span className="session-score">⭐ {s.avgScore.toFixed(1)}</span>}
                </div>
              </div>
              <button 
                className="btn-delete-session" 
                onClick={(e) => handleDeleteSession(s.sessionId, e)}
                title="Delete history"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="btn-sidebar-secondary" onClick={handleLogout}>
            🚪 Sign Out
          </button>
          <button className="btn-sidebar-secondary danger" onClick={handleClearHistory}>
            🧹 Clear All History
          </button>
        </div>
      </aside>

      <main className="main">
        {!activeSession ? (
          <div className="empty-state">
            <div className="empty-glow">🧠</div>
            <h1 className="empty-title">Welcome, {user.name}</h1>
            <p className="empty-subtitle">
              Ready to level up? Start a session and I'll adapt the questions to your current skill level.
            </p>
            <div className="start-options">
              {(['dsa', 'backend', 'system-design'] as const).map((type) => (
                <div
                  key={type}
                  className="start-card"
                  onClick={() => setShowModal(true)}
                >
                  <span className="start-card-icon">{typeIcon[type]}</span>
                  <div className="start-card-title">{typeLabel[type]}</div>
                  <div className="start-card-desc">
                    {type === 'dsa' && 'Algorithms & Patterns'}
                    {type === 'backend' && 'APIs & Infrastructure'}
                    {type === 'system-design' && 'Scalable Architecture'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : view === 'chat' ? (
          <ChatView session={activeSession} />
        ) : (
          <Analytics sessionId={activeSession.sessionId} />
        )}
      </main>

      {showModal && (
        <NewSessionModal onClose={() => setShowModal(false)} onCreate={handleSessionCreated} />
      )}
    </div>
  );
}
