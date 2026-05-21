import type { Readable } from "node:stream";

export type AntivirusVerdict = "clean" | "infected";

export interface AntivirusScanInput {
  body: Readable;
  filename?: string;
}

export interface AntivirusScanResult {
  verdict: AntivirusVerdict;
  signature?: string;
  rawReply: string;
}

export interface AntivirusScanner {
  readonly provider: string;
  scan(input: AntivirusScanInput): Promise<AntivirusScanResult>;
}

export type AntivirusErrorCode =
  | "antivirus_unavailable"
  | "antivirus_protocol_error"
  | "antivirus_scan_failed";

export class AntivirusError extends Error {
  readonly code: AntivirusErrorCode;
  readonly cause?: unknown;

  constructor(code: AntivirusErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AntivirusError";
    this.code = code;
    this.cause = cause;
  }
}
