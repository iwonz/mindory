export interface UiConfig {
  apiUrl: string;
}

export interface StoredConnection {
  apiUrl: string;
  token: string;
}

export interface HealthResponse {
  status?: string;
  service?: string;
  uptime_ms?: number;
  timestamp?: string;
  message?: string;
  checks?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface Peer {
  id: string;
  project_id: string;
  type: string;
  name: string;
  external_id?: string | null;
}

export interface Session {
  id: string;
  project_id: string;
  title?: string | null;
  status?: string;
  source?: Record<string, unknown>;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  project_id: string;
  session_id: string;
  author_peer_id: string;
  role: string;
  content: string;
  source?: Record<string, unknown>;
  created_at?: string;
}

declare global {
  interface Window {
    __MINDORY_UI_CONFIG__?: UiConfig;
  }
}
