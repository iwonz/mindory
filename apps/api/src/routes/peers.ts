import type { FastifyInstance } from "fastify";
import type { PeerRecord, PeerRepository, UpsertPeerInput } from "@mindory/core/projects";
import { requireProjectPermission } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";

export interface PeerRouteDependencies extends RouteDependencyOptions {
  peerRepository?: PeerRepository;
}

const peerBodySchema = {
  type: "object",
  required: ["id", "projectId", "type", "name"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["human", "agent", "service", "automation", "group"] },
    name: { type: "string", minLength: 1 },
    externalId: { type: ["string", "null"] },
    source: { type: "object", additionalProperties: true },
    metadata: { type: "object", additionalProperties: true }
  }
} as const;

export async function registerPeerRoutes(app: FastifyInstance, dependencies: PeerRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Peer routes", dependencies, [["peerRepository", dependencies.peerRepository]]);

  app.post<{ Body: UpsertPeerInput }>("/v1/peers", {
    schema: {
      body: peerBodySchema
    }
  }, async (request, reply) => {
    const peerRepository = requireRouteDependency(dependencies.peerRepository, "peerRepository");
    requireProjectPermission(request, request.body.projectId, "project:read");

    const peer = await peerRepository.upsertPeer(request.body);
    reply.status(201).send(toPeerResponse(peer));
  });

  app.get<{ Querystring: { projectId: string; limit?: number } }>("/v1/peers", async (request) => {
    const peerRepository = requireRouteDependency(dependencies.peerRepository, "peerRepository");
    requireProjectPermission(request, request.query.projectId, "project:read");

    return {
      peers: (await peerRepository.listPeers(request.query.projectId, request.query.limit ?? 100)).map(toPeerResponse)
    };
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string } }>("/v1/peers/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request) => {
    const peerRepository = requireRouteDependency(dependencies.peerRepository, "peerRepository");
    requireProjectPermission(request, request.query.projectId, "project:read");

    return toPeerResponse(await peerRepository.getPeer(request.query.projectId, request.params.id));
  });
}

function toPeerResponse(peer: PeerRecord): Record<string, unknown> {
  return {
    id: peer.id,
    project_id: peer.projectId,
    type: peer.type,
    name: peer.name,
    external_id: peer.externalId,
    source: peer.source,
    metadata: peer.metadata,
    created_at: peer.createdAt.toISOString(),
    updated_at: peer.updatedAt.toISOString()
  };
}
