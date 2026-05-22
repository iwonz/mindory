import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyServerOptions } from "fastify";
import { loadMindoryConfig, type MindoryConfig } from "@mindory/config";
import { registerAuth, type ApiAuthDependencies } from "./auth.js";
import { registerErrorHandlers } from "./errors.js";
import { registerArtifactRoutes, type ArtifactRouteDependencies } from "./routes/artifacts.js";
import { registerRequestGuards } from "./request-guard.js";
import { registerContextRoutes, type ContextRouteDependencies } from "./routes/context.js";
import { registerDocumentRoutes, type DocumentRouteDependencies } from "./routes/documents.js";
import { registerFaceRoutes, type FaceRouteDependencies } from "./routes/faces.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobRoutes, type JobRouteDependencies } from "./routes/jobs.js";
import { registerMemoryRoutes, type MemoryRouteDependencies } from "./routes/memories.js";
import { registerPeerRoutes, type PeerRouteDependencies } from "./routes/peers.js";
import { registerProjectRoutes, type ProjectRouteDependencies } from "./routes/projects.js";
import { registerSearchRoutes, type SearchRouteDependencies } from "./routes/search.js";
import { registerSessionRoutes, type SessionRouteDependencies } from "./routes/sessions.js";
import { registerTokenRoutes, type TokenRouteDependencies } from "./routes/tokens.js";

export interface BuildApiAppOptions {
  config?: MindoryConfig;
  logger?: FastifyServerOptions["logger"];
  allowDependencyFreeRoutes?: boolean;
  auth?: ApiAuthDependencies;
  artifacts?: ArtifactRouteDependencies;
  tokens?: TokenRouteDependencies;
  projects?: ProjectRouteDependencies;
  peers?: PeerRouteDependencies;
  sessions?: SessionRouteDependencies;
  documents?: DocumentRouteDependencies;
  faces?: FaceRouteDependencies;
  jobs?: JobRouteDependencies;
  memories?: MemoryRouteDependencies;
  search?: SearchRouteDependencies;
  context?: ContextRouteDependencies;
  close?: () => Promise<void>;
}

function loggerOptions(config: MindoryConfig): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: config.log.level,
    redact: [
      "req.headers.authorization",
      "request.headers.authorization",
      "headers.authorization"
    ]
  };
}

export async function buildApiApp(options: BuildApiAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadMindoryConfig();
  const fastifyOptions: FastifyServerOptions = {
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      return Array.isArray(header) ? header[0] ?? randomUUID() : header ?? randomUUID();
    }
  };
  fastifyOptions.logger = options.logger === undefined ? loggerOptions(config) : options.logger;

  const app = Fastify(fastifyOptions);

  app.decorate("mindoryConfig", config);

  registerErrorHandlers(app);
  registerRequestGuards(app, config);
  await registerAuth(app, withDependencyFreeRouteMode(options.auth, options.allowDependencyFreeRoutes));
  await registerHealthRoutes(app, config);
  await registerArtifactRoutes(app, withDependencyFreeRouteMode(options.artifacts, options.allowDependencyFreeRoutes));
  await registerTokenRoutes(app, withDependencyFreeRouteMode(options.tokens, options.allowDependencyFreeRoutes));
  await registerProjectRoutes(app, withDependencyFreeRouteMode(options.projects, options.allowDependencyFreeRoutes));
  await registerPeerRoutes(app, withDependencyFreeRouteMode(options.peers, options.allowDependencyFreeRoutes));
  await registerSessionRoutes(app, withDependencyFreeRouteMode(options.sessions, options.allowDependencyFreeRoutes));
  await registerDocumentRoutes(app, withDependencyFreeRouteMode(options.documents, options.allowDependencyFreeRoutes));
  await registerFaceRoutes(app, withDependencyFreeRouteMode(options.faces, options.allowDependencyFreeRoutes));
  await registerJobRoutes(app, withDependencyFreeRouteMode(options.jobs, options.allowDependencyFreeRoutes));
  await registerMemoryRoutes(app, withDependencyFreeRouteMode(options.memories, options.allowDependencyFreeRoutes));
  await registerSearchRoutes(app, withDependencyFreeRouteMode(options.search, options.allowDependencyFreeRoutes));
  await registerContextRoutes(app, withDependencyFreeRouteMode(options.context, options.allowDependencyFreeRoutes));
  if (options.close) {
    app.addHook("onClose", async () => {
      await options.close?.();
    });
  }

  return app;
}

function withDependencyFreeRouteMode<T extends object>(dependencies: T | undefined, allowDependencyFreeRoutes: boolean | undefined): T & { allowDependencyFreeRoutes?: boolean } {
  if (allowDependencyFreeRoutes !== true) {
    return dependencies ?? {} as T & { allowDependencyFreeRoutes?: boolean };
  }
  return {
    ...(dependencies ?? {}),
    allowDependencyFreeRoutes: true
  } as T & { allowDependencyFreeRoutes?: boolean };
}

declare module "fastify" {
  interface FastifyInstance {
    mindoryConfig: MindoryConfig;
  }
}

export type ApiLogger = FastifyBaseLogger;
