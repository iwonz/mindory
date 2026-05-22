import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MindoryTracer, MindoryTraceSpan } from "@mindory/observability";

export async function registerTracingHooks(app: FastifyInstance, tracer: MindoryTracer | undefined): Promise<void> {
  if (tracer === undefined || !tracer.enabled) {
    return;
  }

  app.addHook("onRequest", async (request) => {
    const traceparentHeader = request.headers.traceparent;
    const parentTraceparent = Array.isArray(traceparentHeader) ? traceparentHeader[0] : traceparentHeader;
    const requestPath = request.url.split("?", 1)[0] ?? request.url;
    const span = tracer.startSpan("api.request", {
      kind: "server",
      refs: {
        requestId: request.id
      },
      attributes: {
        "http.request.method": request.method,
        "url.path": requestPath,
        "mindory.request_id": request.id
      },
      ...(parentTraceparent === undefined ? {} : { parentTraceparent })
    });
    request.mindoryTraceSpan = span;
    tracer.activateSpan(span);
  });

  app.addHook("preHandler", async (request) => {
    const span = request.mindoryTraceSpan;
    if (span !== undefined) {
      tracer.activateSpan(span);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const span = request.mindoryTraceSpan;
    if (span === undefined) {
      return;
    }
    span.setAttribute("http.route", request.routeOptions.url ?? request.url.split("?", 1)[0] ?? request.url);
    span.setAttribute("http.response.status_code", reply.statusCode);
    span.end({ status: reply.statusCode >= 500 ? "error" : "ok" });
  });

  app.addHook("onError", async (request, _reply, error) => {
    request.mindoryTraceSpan?.end({
      status: "error",
      error
    });
  });
}

export function traceMetadataForRequest(request: FastifyRequest): Record<string, string> {
  const span = request.mindoryTraceSpan;
  if (span === undefined) {
    return {
      request_id: request.id
    };
  }
  return {
    request_id: request.id,
    correlation_id: request.id,
    traceparent: span.context.traceparent,
    trace_id: span.context.traceId,
    parent_span_id: span.context.spanId
  };
}

declare module "fastify" {
  interface FastifyRequest {
    mindoryTraceSpan?: MindoryTraceSpan;
  }
}
