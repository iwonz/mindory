import type { SourceSnapshot } from "./documents.js";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProjectRepository {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord>;
  listProjects(limit: number): Promise<ProjectRecord[]>;
}

export type PeerType =
  | "human"
  | "agent"
  | "service"
  | "automation"
  | "group";

export interface PeerRecord {
  id: string;
  projectId: string;
  type: PeerType;
  name: string;
  externalId: string | null;
  source: SourceSnapshot;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertPeerInput {
  id: string;
  projectId: string;
  type: PeerType;
  name: string;
  externalId?: string | null;
  source?: SourceSnapshot;
  metadata?: Record<string, unknown>;
}

export interface PeerRepository {
  upsertPeer(input: UpsertPeerInput): Promise<PeerRecord>;
  getPeer(projectId: string, peerId: string): Promise<PeerRecord>;
  listPeers(projectId: string, limit: number): Promise<PeerRecord[]>;
}

export type ProjectErrorCode =
  | "peer_not_found"
  | "project_not_found";

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;

  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
  }
}
