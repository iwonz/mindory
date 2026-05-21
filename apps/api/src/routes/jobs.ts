import type { FastifyInstance } from "fastify";
import { buildProcessingJobDetails, type ListProcessingJobsInput, type ProcessingJobDispatcher, type ProcessingJobRecord, type ProcessingJobStatus, type ProcessingJobStore, type ProcessingJobType } from "@mindory/core/queue";
import { requireProjectPermission } from "../auth.js";
import { notImplemented } from "../errors.js";

export interface JobRouteDependencies {
  jobStore?: ProcessingJobStore;
  jobDispatcher?: ProcessingJobDispatcher;
}

interface ProjectQuery {
  projectId: string;
}

interface JobParams {
  id: string;
}

export async function registerJobRoutes(app: FastifyInstance, dependencies: JobRouteDependencies = {}): Promise<void> {
  app.get<{ Params: JobParams; Querystring: ProjectQuery }>("/v1/jobs/:id", async (request) => {
    if (!dependencies.jobStore) {
      throw notImplemented("Processing job lookup requires job store runtime dependencies.");
    }
    requireProjectPermission(request, request.query.projectId, "project:read");

    return toJobResponse(await dependencies.jobStore.getJob(request.query.projectId, request.params.id));
  });

  app.get<{ Querystring: { projectId: string; status?: ProcessingJobStatus; type?: ProcessingJobType; limit?: number } }>("/v1/jobs", async (request) => {
    if (!dependencies.jobStore) {
      throw notImplemented("Processing job listing requires job store runtime dependencies.");
    }
    requireProjectPermission(request, request.query.projectId, "project:read");

    const listInput: ListProcessingJobsInput = {
      projectId: request.query.projectId,
      limit: request.query.limit ?? 50
    };
    if (request.query.status !== undefined) {
      listInput.status = request.query.status;
    }
    if (request.query.type !== undefined) {
      listInput.type = request.query.type;
    }

    return {
      jobs: (await dependencies.jobStore.listJobs(listInput)).map(toJobResponse)
    };
  });

  app.post<{ Params: JobParams; Body: ProjectQuery }>("/v1/jobs/:id/retry", async (request, reply) => {
    if (!dependencies.jobDispatcher) {
      throw notImplemented("Processing job retry requires job dispatcher runtime dependencies.");
    }
    requireProjectPermission(request, request.body.projectId, "project:read");

    const enqueued = await dependencies.jobDispatcher.retry(request.body.projectId, request.params.id);
    reply.status(202).send({
      job: toJobResponse(await dependencies.jobDispatcher.store.getJob(request.body.projectId, request.params.id)),
      retry: {
        queue_name: enqueued.queueName,
        queue_job_id: enqueued.queueJobId,
        processing_job_id: enqueued.processingJobId
      }
    });
  });
}

function toJobResponse(job: ProcessingJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    project_id: job.projectId,
    type: job.type,
    target_type: job.targetType,
    target_id: job.targetId,
    status: job.status,
    idempotency_key: job.idempotencyKey,
    processor_version: job.processorVersion,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    last_error: job.lastError,
    details: buildProcessingJobDetails(job),
    metadata: job.metadata,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null
  };
}
