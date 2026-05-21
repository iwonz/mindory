import net from "node:net";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  AntivirusError,
  type AntivirusScanInput,
  type AntivirusScanResult,
  type AntivirusScanner
} from "@mindory/core/antivirus";
import {
  type DocumentAntivirusPolicy,
  type DocumentRepository
} from "@mindory/core/documents";
import {
  type ProcessingJobDispatcher,
  type ProcessingJobProcessor,
  type ProcessingJobProcessorContext,
  type ProcessingJobResult
} from "@mindory/core/queue";
import type { ObjectStorage } from "@mindory/core/storage";

export interface ClamAvScannerOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  chunkSizeBytes?: number;
}

export class ClamAvScanner implements AntivirusScanner {
  readonly provider = "clamav";
  private readonly options: Required<ClamAvScannerOptions>;

  constructor(options: ClamAvScannerOptions) {
    this.options = {
      timeoutMs: options.timeoutMs ?? 30_000,
      chunkSizeBytes: options.chunkSizeBytes ?? 64 * 1024,
      ...options
    };
  }

  async scan(input: AntivirusScanInput): Promise<AntivirusScanResult> {
    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port
    });
    socket.setTimeout(this.options.timeoutMs);

    const replyChunks: Buffer[] = [];
    socket.on("data", (chunk) => {
      replyChunks.push(Buffer.from(chunk));
    });

    try {
      await once(socket, "connect");
      socket.write("zINSTREAM\0");
      await pipeline(input.body, this.createInstreamWriter(socket));
      socket.write(Buffer.alloc(4));
      socket.end();
      await once(socket, "close");
      return parseClamAvReply(Buffer.concat(replyChunks).toString("utf8").replaceAll("\0", "\n"));
    } catch (error) {
      socket.destroy();
      if (error instanceof AntivirusError) {
        throw error;
      }
      throw new AntivirusError("antivirus_unavailable", "ClamAV scan failed before a verdict was returned.", error);
    }
  }

  private createInstreamWriter(socket: net.Socket): Writable {
    return new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        for (let offset = 0; offset < buffer.length; offset += this.options.chunkSizeBytes) {
          const slice = buffer.subarray(offset, offset + this.options.chunkSizeBytes);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(slice.length, 0);
          socket.write(length);
          socket.write(slice);
        }
        callback();
      }
    });
  }
}

export interface ClamAvDocumentScanProcessorOptions {
  storage: ObjectStorage;
  documents: DocumentRepository;
  scanner: AntivirusScanner;
  policy: DocumentAntivirusPolicy;
  jobs?: ProcessingJobDispatcher;
  nextProcessorVersion?: string;
  processorVersion?: string;
}

export class ClamAvDocumentScanProcessor implements ProcessingJobProcessor {
  readonly type = "document.scan" as const;
  readonly processorVersion: string;
  private readonly storage: ObjectStorage;
  private readonly documents: DocumentRepository;
  private readonly scanner: AntivirusScanner;
  private readonly policy: DocumentAntivirusPolicy;
  private readonly jobs: ProcessingJobDispatcher | undefined;
  private readonly nextProcessorVersion: string;

  constructor(options: ClamAvDocumentScanProcessorOptions) {
    this.storage = options.storage;
    this.documents = options.documents;
    this.scanner = options.scanner;
    this.policy = options.policy;
    this.jobs = options.jobs;
    this.nextProcessorVersion = options.nextProcessorVersion ?? "document-route-v1";
    this.processorVersion = options.processorVersion ?? "clamav-v1";
  }

  async process(context: ProcessingJobProcessorContext): Promise<ProcessingJobResult> {
    const document = await this.documents.getDocument(context.payload.projectId, context.payload.targetId);
    const object = await this.storage.getObject(document.storageKey);

    try {
      const result = await this.scanner.scan({
        body: object.body,
        filename: document.originalFilename
      });

      if (result.verdict === "clean") {
        await this.documents.updateDocumentStatus({
          projectId: document.projectId,
          documentId: document.id,
          status: "scan_clean",
          metadata: {
            ...document.metadata,
            antivirus: result
          }
        });
        const routeJob = await this.jobs?.createAndEnqueue({
          projectId: document.projectId,
          type: "document.route",
          targetType: "document",
          targetId: document.id,
          idempotencyKey: `document.route:${document.id}:${this.nextProcessorVersion}`,
          processorVersion: this.nextProcessorVersion,
          metadata: {
            previous_job_id: context.payload.jobId,
            storage_key: document.storageKey,
            antivirus_provider: this.policy.provider
          }
        });
        return {
          stageGraph: [
            {
              stage: "scan",
              status: "succeeded",
              metadata: {
                antivirus_provider: this.policy.provider,
                verdict: result.verdict
              }
            },
            ...(routeJob ? [{
              stage: "route",
              status: "pending" as const,
              jobId: routeJob.processingJobId,
              queueJobId: routeJob.queueJobId
            }] : [])
          ]
        };
      }

      await this.documents.updateDocumentStatus({
        projectId: document.projectId,
        documentId: document.id,
        status: this.policy.onInfected === "quarantine" ? "quarantined" : "scan_infected",
        metadata: {
          ...document.metadata,
          antivirus: result
        }
      });
      return {
        statusDetail: "blocked_by_scan",
        stageGraph: [{
          stage: "scan",
          status: "blocked_by_scan",
          reason: "infected",
          metadata: {
            antivirus_provider: this.policy.provider,
            verdict: result.verdict,
            signature: result.signature ?? null
          }
        }]
      };
    } catch (error) {
      await this.documents.updateDocumentStatus({
        projectId: document.projectId,
        documentId: document.id,
        status: this.policy.onScanFailure === "allow_with_warning" ? "scan_failed" : "quarantined",
        metadata: {
          ...document.metadata,
          antivirus_error: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }
}

export function parseClamAvReply(rawReply: string): AntivirusScanResult {
  const reply = rawReply.trim();
  if (reply.endsWith(": OK")) {
    return {
      verdict: "clean",
      rawReply: reply
    };
  }

  const infectedMatch = reply.match(/: (.+) FOUND$/);
  if (infectedMatch?.[1]) {
    return {
      verdict: "infected",
      signature: infectedMatch[1],
      rawReply: reply
    };
  }

  throw new AntivirusError("antivirus_protocol_error", `Unexpected ClamAV reply: ${reply || "<empty>"}`);
}
