export interface HermesIdentityInput {
  projectId?: string;
  externalUserId?: string;
  externalSessionId: string;
  agentId?: string;
}

export interface HermesIdentityDefaults {
  defaultProject: string;
  defaultUserPeer: string;
  defaultAgentPeer: string;
}

export interface MindoryHermesIdentity {
  projectId: string;
  userPeerId: string;
  agentPeerId: string;
  sessionId: string;
  externalUserId: string | null;
  externalSessionId: string;
  agentId: string | null;
  usedDefaultUserPeer: boolean;
  usedDefaultAgentPeer: boolean;
}

export function mapHermesIdentity(input: HermesIdentityInput, defaults: HermesIdentityDefaults): MindoryHermesIdentity {
  const projectId = input.projectId ?? defaults.defaultProject;
  const externalSessionId = requireStableIdentity(input.externalSessionId, "externalSessionId");
  const externalUserId = input.externalUserId ?? null;
  const agentId = input.agentId ?? null;

  return {
    projectId,
    userPeerId: externalUserId
      ? stableMindoryId("peer", "hermes", "user", projectId, externalUserId)
      : defaults.defaultUserPeer,
    agentPeerId: agentId
      ? stableMindoryId("peer", "hermes", "agent", projectId, agentId)
      : defaults.defaultAgentPeer,
    sessionId: stableMindoryId("sess", "hermes", "session", projectId, externalSessionId),
    externalUserId,
    externalSessionId,
    agentId,
    usedDefaultUserPeer: externalUserId === null,
    usedDefaultAgentPeer: agentId === null
  };
}

export function stableMindoryId(prefix: string, integration: string, kind: string, projectId: string, externalId: string): string {
  return [
    prefix,
    sanitizeIdentitySegment(integration),
    sanitizeIdentitySegment(kind),
    sanitizeIdentitySegment(projectId),
    sanitizeIdentitySegment(externalId)
  ].join("_");
}

export function sanitizeIdentitySegment(value: string): string {
  const sanitized = value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "unknown";
}

function requireStableIdentity(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new HermesAdapterIdentityError(`${fieldName} is required to preserve stable Hermes mappings.`);
  }
  return value;
}

export class HermesAdapterIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HermesAdapterIdentityError";
  }
}
