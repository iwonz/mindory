import { loadMindoryConfig, type EnvSource } from "@mindory/config";
import { parseCliArgs, readFlag } from "./args.js";
import { CliError, dispatchCliCommand, helpText } from "./commands.js";
import {
  MindoryCliApiClient,
  MindoryCliApiError,
  MindoryCliNetworkError,
  type MindoryCliApiClientOptions
} from "./http-client.js";

export interface RunMindoryCliOptions {
  argv: string[];
  env?: EnvSource;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  apiClient?: MindoryCliApiClient;
}

export async function runMindoryCli(options: RunMindoryCliOptions): Promise<number> {
  const stdout = options.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const stderr = options.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const parsed = parseCliArgs(options.argv);

  if (parsed.positionals.length === 0 || parsed.flags.help === true) {
    stdout(helpText());
    return 0;
  }

  const config = loadMindoryConfig(options.env);
  const clientOptions: MindoryCliApiClientOptions = {
    baseUrl: readFlag(parsed.flags, "api-url") ?? (config.cli.apiUrl || config.api.publicUrl)
  };
  const token = readFlag(parsed.flags, "token") ?? config.cli.apiToken;
  if (token) {
    clientOptions.token = token;
  }
  const api = options.apiClient ?? new MindoryCliApiClient(clientOptions);

  try {
    const commandContext = options.env === undefined ? { api } : { api, env: options.env };
    const result = await dispatchCliCommand(parsed, commandContext);
    if (result !== undefined) {
      stdout(formatResult(result));
    }
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      stderr(error.message);
      return error.exitCode;
    }
    if (error instanceof MindoryCliApiError) {
      stderr(formatApiError(error));
      return 3;
    }
    if (error instanceof MindoryCliNetworkError) {
      stderr(error.message);
      return 4;
    }
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function formatResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function formatApiError(error: MindoryCliApiError): string {
  const code = error.apiCode ? ` ${error.apiCode}` : "";
  return `API ${error.statusCode}${code}: ${error.message}`;
}
