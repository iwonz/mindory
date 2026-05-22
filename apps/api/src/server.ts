import { loadMindoryConfig } from "@mindory/config";
import { buildApiApp } from "./app.js";
import { buildApiRuntimeDependencies } from "./runtime.js";

export async function startApiServer(): Promise<void> {
  const config = loadMindoryConfig();
  const runtime = buildApiRuntimeDependencies(config);
  const app = await buildApiApp({ config, ...runtime, allowDependencyFreeRoutes: false });

  try {
    await app.listen({
      host: config.api.host,
      port: config.api.port
    });
  } catch (error) {
    app.log.error({ err: error }, "Mindory API failed to start.");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startApiServer();
}
