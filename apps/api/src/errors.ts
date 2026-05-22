import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function sendError(reply: FastifyReply, request: FastifyRequest, error: ApiError): void {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      requestId: request.id,
      details: error.details
    }
  };

  reply.status(error.statusCode).type("application/json").send(body);
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, request, new ApiError(404, "not_found", `Route ${request.method} ${request.url} was not found.`));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      request.log.info({ err: error, request_id: request.id }, "Request failed with expected API error.");
      sendError(reply, request, error);
      return;
    }

    if (isRepositoryNotFoundError(error)) {
      request.log.info({ err: error, request_id: request.id }, "Repository lookup returned not found.");
      sendError(reply, request, new ApiError(404, "not_found", error.message));
      return;
    }

    const statusCode = hasStatusCode(error) && error.statusCode >= 400 ? error.statusCode : 500;
    const code = statusCode === 500 ? "internal_server_error" : "request_error";
    const message = error instanceof Error ? error.message : "Request error.";
    request.log.error({ err: error, request_id: request.id }, "Unhandled request error.");
    sendError(reply, request, new ApiError(statusCode, code, statusCode === 500 ? "Internal server error." : message));
  });
}

function isRepositoryNotFoundError(error: unknown): error is Error {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "not_found";
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number";
}
