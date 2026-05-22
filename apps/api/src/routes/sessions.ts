import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EnqueuedProcessingJob, ProcessingJobDispatcher } from "@mindory/core/queue";
import type { AppendMessageInput, CreateSessionInput, MessageRecord, SessionRecord, SessionRepository } from "@mindory/core/sessions";
import { requireProjectPermission } from "../auth.js";
import { assertRouteDependencies, requireRouteDependency, type RouteDependencyOptions } from "./dependencies.js";
import { traceMetadataForRequest } from "./tracing.js";

export interface SessionRouteDependencies extends RouteDependencyOptions {
  sessionRepository?: SessionRepository;
  jobDispatcher?: ProcessingJobDispatcher;
  idFactory?: () => string;
}

type SessionBody = Omit<CreateSessionInput, "id"> & { id?: string };
type MessageBody = Omit<AppendMessageInput, "id" | "sessionId"> & { id?: string };

export async function registerSessionRoutes(app: FastifyInstance, dependencies: SessionRouteDependencies = {}): Promise<void> {
  assertRouteDependencies("Session routes", dependencies, [["sessionRepository", dependencies.sessionRepository]]);
  const idFactory = dependencies.idFactory ?? (() => randomUUID());

  app.post<{ Body: SessionBody }>("/v1/sessions", async (request, reply) => {
    const sessionRepository = requireRouteDependency(dependencies.sessionRepository, "sessionRepository");
    requireProjectPermission(request, request.body.projectId, "session:write");

    const session = await sessionRepository.createSession({
      ...request.body,
      id: request.body.id ?? `sess_${idFactory()}`
    });
    reply.status(201).send(toSessionResponse(session));
  });

  app.get<{ Querystring: { projectId: string; limit?: number } }>("/v1/sessions", async (request) => {
    const sessionRepository = requireRouteDependency(dependencies.sessionRepository, "sessionRepository");
    requireProjectPermission(request, request.query.projectId, "session:read");

    return {
      sessions: (await sessionRepository.listSessions(request.query.projectId, request.query.limit ?? 100)).map(toSessionResponse)
    };
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string } }>("/v1/sessions/:id", async (request) => {
    const sessionRepository = requireRouteDependency(dependencies.sessionRepository, "sessionRepository");
    requireProjectPermission(request, request.query.projectId, "session:read");

    return toSessionResponse(await sessionRepository.getSession(request.query.projectId, request.params.id));
  });

  app.post<{ Params: { id: string }; Body: MessageBody }>("/v1/sessions/:id/messages", async (request, reply) => {
    const sessionRepository = requireRouteDependency(dependencies.sessionRepository, "sessionRepository");
    requireProjectPermission(request, request.body.projectId, "message:write");

    const message = await sessionRepository.appendMessage({
      ...request.body,
      id: request.body.id ?? `msg_${idFactory()}`,
      sessionId: request.params.id
    });
    const processingJobs = await enqueueMessageRuntimeJobs(dependencies.jobDispatcher, message, traceMetadataForRequest(request));
    const response = toMessageResponse(message);
    if (processingJobs.length > 0) {
      response.processing_jobs = processingJobs.map(toProcessingJobResponse);
    }
    reply.status(201).send(response);
  });

  app.get<{ Params: { id: string }; Querystring: { projectId: string; limit?: number } }>("/v1/sessions/:id/messages", async (request) => {
    const sessionRepository = requireRouteDependency(dependencies.sessionRepository, "sessionRepository");
    requireProjectPermission(request, request.query.projectId, "message:read");

    return {
      messages: (await sessionRepository.listMessages(
        request.query.projectId,
        request.params.id,
        request.query.limit ?? 50
      )).map(toMessageResponse)
    };
  });
}

function toSessionResponse(session: SessionRecord): Record<string, unknown> {
  return {
    id: session.id,
    project_id: session.projectId,
    title: session.title,
    status: session.status,
    source: session.source,
    summary: session.summary,
    metadata: session.metadata,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString()
  };
}

function toMessageResponse(message: MessageRecord): Record<string, unknown> {
  return {
    id: message.id,
    project_id: message.projectId,
    session_id: message.sessionId,
    author_peer_id: message.authorPeerId,
    role: message.role,
    content: message.content,
    source: message.source,
    metadata: message.metadata,
    created_at: message.createdAt.toISOString()
  };
}

async function enqueueMessageRuntimeJobs(
  jobDispatcher: ProcessingJobDispatcher | undefined,
  message: MessageRecord,
  runtimeMetadata: Record<string, unknown>
): Promise<EnqueuedProcessingJob[]> {
  if (!jobDispatcher) {
    return [];
  }

  return Promise.all([
    jobDispatcher.createAndEnqueue({
      projectId: message.projectId,
      type: "session.summarize",
      targetType: "session",
      targetId: message.sessionId,
      idempotencyKey: `session.summarize:${message.sessionId}:${message.id}:session-summary-v1`,
      processorVersion: "session-summary-v1",
      metadata: {
        ...runtimeMetadata,
        trigger: "message_appended",
        message_id: message.id
      }
    }),
    jobDispatcher.createAndEnqueue({
      projectId: message.projectId,
      type: "memory.derive",
      targetType: "session",
      targetId: message.sessionId,
      idempotencyKey: `memory.derive:${message.sessionId}:${message.id}:explicit-memory-cues-v1`,
      processorVersion: "memory-derive-conservative-v1",
      metadata: {
        ...runtimeMetadata,
        trigger: "message_appended",
        message_id: message.id
      }
    })
  ]);
}

function toProcessingJobResponse(job: EnqueuedProcessingJob): Record<string, unknown> {
  return {
    queue_name: job.queueName,
    queue_job_id: job.queueJobId,
    processing_job_id: job.processingJobId,
    type: job.payload.type
  };
}
