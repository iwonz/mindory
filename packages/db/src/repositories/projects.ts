import { desc, eq, and } from "drizzle-orm";
import type {
  CreateProjectInput,
  PeerRecord,
  ProjectRecord,
  ProjectRepository,
  UpsertPeerInput,
  PeerRepository
} from "@mindory/core/projects";
import { peers, projects } from "../schema.js";
import { firstOrThrow, type MindoryDatabase } from "./types.js";

export class DbProjectRepository implements ProjectRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const row = firstOrThrow(await this.db.insert(projects).values({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      metadata: input.metadata ?? {}
    }).onConflictDoUpdate({
      target: projects.id,
      set: {
        name: input.name,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date()
      }
    }).returning(), `Project ${input.id} was not created.`);

    return mapProject(row);
  }

  async getProject(projectId: string): Promise<ProjectRecord> {
    const rows = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    return mapProject(firstOrThrow(rows, `Project ${projectId} was not found.`));
  }

  async listProjects(limit: number): Promise<ProjectRecord[]> {
    const rows = await this.db.select().from(projects).orderBy(desc(projects.updatedAt)).limit(limit);
    return rows.map(mapProject);
  }
}

export class DbPeerRepository implements PeerRepository {
  readonly db: MindoryDatabase;

  constructor(db: MindoryDatabase) {
    this.db = db;
  }

  async upsertPeer(input: UpsertPeerInput): Promise<PeerRecord> {
    const existingPeer = input.externalId
      ? await this.db.select().from(peers).where(and(
        eq(peers.projectId, input.projectId),
        eq(peers.externalId, input.externalId)
      )).limit(1)
      : [];

    if (existingPeer[0]) {
      const [row] = await this.db.update(peers).set({
        type: input.type,
        name: input.name,
        externalId: input.externalId,
        source: input.source ?? { type: "api" },
        metadata: input.metadata ?? {},
        updatedAt: new Date()
      }).where(eq(peers.id, existingPeer[0].id)).returning();

      return mapPeer(firstOrThrow(row ? [row] : [], `Peer ${existingPeer[0].id} was not updated.`));
    }

    const [row] = await this.db.insert(peers).values({
      id: input.id,
      projectId: input.projectId,
      type: input.type,
      name: input.name,
      externalId: input.externalId ?? null,
      source: input.source ?? { type: "api" },
      metadata: input.metadata ?? {}
    }).onConflictDoUpdate({
      target: peers.id,
      set: {
        type: input.type,
        name: input.name,
        externalId: input.externalId ?? null,
        source: input.source ?? { type: "api" },
        metadata: input.metadata ?? {},
        updatedAt: new Date()
      }
    }).returning();

    return mapPeer(firstOrThrow(row ? [row] : [], `Peer ${input.id} was not upserted.`));
  }

  async getPeer(projectId: string, peerId: string): Promise<PeerRecord> {
    const rows = await this.db.select().from(peers).where(and(eq(peers.projectId, projectId), eq(peers.id, peerId))).limit(1);
    return mapPeer(firstOrThrow(rows, `Peer ${peerId} was not found.`));
  }

  async listPeers(projectId: string, limit: number): Promise<PeerRecord[]> {
    const rows = await this.db.select().from(peers).where(eq(peers.projectId, projectId)).orderBy(desc(peers.updatedAt)).limit(limit);
    return rows.map(mapPeer);
  }
}

function mapProject(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapPeer(row: typeof peers.$inferSelect): PeerRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    externalId: row.externalId,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
