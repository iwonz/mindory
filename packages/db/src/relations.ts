import { relations } from "drizzle-orm";
import {
  accessTokenProjectScopes,
  accessTokens,
  attachments,
  documentArtifactTextSpans,
  documentArtifactVectors,
  documentArtifacts,
  documentMediaMetadata,
  documentMetadataIndex,
  faceIdentities,
  faceObservations,
  chunkVectorEmbeddings,
  chunks,
  documents,
  memoryClaims,
  messages,
  peers,
  processingJobs,
  processingRuns,
  projects,
  sessionPeers,
  sessions
} from "./schema.js";

export const projectsRelations = relations(projects, ({ many }) => ({
  accessTokens: many(accessTokens),
  peers: many(peers),
  sessions: many(sessions),
  messages: many(messages),
  documents: many(documents),
  chunks: many(chunks),
  chunkVectorEmbeddings: many(chunkVectorEmbeddings),
  processingRuns: many(processingRuns),
  documentArtifacts: many(documentArtifacts),
  documentArtifactVectors: many(documentArtifactVectors),
  documentMediaMetadata: many(documentMediaMetadata),
  documentMetadataIndex: many(documentMetadataIndex),
  faceIdentities: many(faceIdentities),
  faceObservations: many(faceObservations),
  memoryClaims: many(memoryClaims),
  processingJobs: many(processingJobs)
}));

export const accessTokensRelations = relations(accessTokens, ({ one, many }) => ({
  project: one(projects, {
    fields: [accessTokens.projectId],
    references: [projects.id]
  }),
  projectScopes: many(accessTokenProjectScopes)
}));

export const accessTokenProjectScopesRelations = relations(accessTokenProjectScopes, ({ one }) => ({
  token: one(accessTokens, {
    fields: [accessTokenProjectScopes.tokenId],
    references: [accessTokens.id]
  }),
  project: one(projects, {
    fields: [accessTokenProjectScopes.projectId],
    references: [projects.id]
  })
}));

export const peersRelations = relations(peers, ({ one, many }) => ({
  project: one(projects, {
    fields: [peers.projectId],
    references: [projects.id]
  }),
  sessions: many(sessionPeers),
  messages: many(messages),
  createdMemoryClaims: many(memoryClaims)
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id]
  }),
  peers: many(sessionPeers),
  messages: many(messages)
}));

export const sessionPeersRelations = relations(sessionPeers, ({ one }) => ({
  project: one(projects, {
    fields: [sessionPeers.projectId],
    references: [projects.id]
  }),
  session: one(sessions, {
    fields: [sessionPeers.sessionId],
    references: [sessions.id]
  }),
  peer: one(peers, {
    fields: [sessionPeers.peerId],
    references: [peers.id]
  })
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  project: one(projects, {
    fields: [messages.projectId],
    references: [projects.id]
  }),
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id]
  }),
  authorPeer: one(peers, {
    fields: [messages.authorPeerId],
    references: [peers.id]
  }),
  attachments: many(attachments)
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id]
  }),
  attachments: many(attachments),
  chunks: many(chunks),
  chunkVectorEmbeddings: many(chunkVectorEmbeddings),
  processingRuns: many(processingRuns),
  artifacts: many(documentArtifacts),
  artifactVectors: many(documentArtifactVectors),
  textSpans: many(documentArtifactTextSpans),
  mediaMetadata: many(documentMediaMetadata),
  metadataIndex: many(documentMetadataIndex),
  faceObservations: many(faceObservations)
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  project: one(projects, {
    fields: [attachments.projectId],
    references: [projects.id]
  }),
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id]
  }),
  document: one(documents, {
    fields: [attachments.documentId],
    references: [documents.id]
  })
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  project: one(projects, {
    fields: [chunks.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id]
  }),
  vectorEmbeddings: many(chunkVectorEmbeddings)
}));

export const chunkVectorEmbeddingsRelations = relations(chunkVectorEmbeddings, ({ one }) => ({
  project: one(projects, {
    fields: [chunkVectorEmbeddings.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [chunkVectorEmbeddings.documentId],
    references: [documents.id]
  }),
  chunk: one(chunks, {
    fields: [chunkVectorEmbeddings.chunkId],
    references: [chunks.id]
  })
}));

export const memoryClaimsRelations = relations(memoryClaims, ({ one }) => ({
  project: one(projects, {
    fields: [memoryClaims.projectId],
    references: [projects.id]
  }),
  createdByPeer: one(peers, {
    fields: [memoryClaims.createdByPeerId],
    references: [peers.id]
  })
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  project: one(projects, {
    fields: [processingJobs.projectId],
    references: [projects.id]
  })
}));

export const processingRunsRelations = relations(processingRuns, ({ one, many }) => ({
  project: one(projects, {
    fields: [processingRuns.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [processingRuns.documentId],
    references: [documents.id]
  }),
  artifacts: many(documentArtifacts),
  metadataIndex: many(documentMetadataIndex),
  faceObservations: many(faceObservations)
}));

export const documentArtifactsRelations = relations(documentArtifacts, ({ one, many }) => ({
  project: one(projects, {
    fields: [documentArtifacts.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [documentArtifacts.documentId],
    references: [documents.id]
  }),
  processingRun: one(processingRuns, {
    fields: [documentArtifacts.processingRunId],
    references: [processingRuns.id]
  }),
  vectors: many(documentArtifactVectors),
  textSpans: many(documentArtifactTextSpans),
  metadataIndex: many(documentMetadataIndex),
  faceObservations: many(faceObservations)
}));

export const documentArtifactVectorsRelations = relations(documentArtifactVectors, ({ one }) => ({
  project: one(projects, {
    fields: [documentArtifactVectors.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [documentArtifactVectors.documentId],
    references: [documents.id]
  }),
  artifact: one(documentArtifacts, {
    fields: [documentArtifactVectors.artifactId],
    references: [documentArtifacts.id]
  })
}));

export const documentArtifactTextSpansRelations = relations(documentArtifactTextSpans, ({ one }) => ({
  project: one(projects, {
    fields: [documentArtifactTextSpans.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [documentArtifactTextSpans.documentId],
    references: [documents.id]
  }),
  artifact: one(documentArtifacts, {
    fields: [documentArtifactTextSpans.artifactId],
    references: [documentArtifacts.id]
  })
}));

export const documentMediaMetadataRelations = relations(documentMediaMetadata, ({ one }) => ({
  project: one(projects, {
    fields: [documentMediaMetadata.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [documentMediaMetadata.documentId],
    references: [documents.id]
  })
}));

export const documentMetadataIndexRelations = relations(documentMetadataIndex, ({ one }) => ({
  project: one(projects, {
    fields: [documentMetadataIndex.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [documentMetadataIndex.documentId],
    references: [documents.id]
  }),
  processingRun: one(processingRuns, {
    fields: [documentMetadataIndex.processingRunId],
    references: [processingRuns.id]
  }),
  artifact: one(documentArtifacts, {
    fields: [documentMetadataIndex.artifactId],
    references: [documentArtifacts.id]
  })
}));

export const faceIdentitiesRelations = relations(faceIdentities, ({ one, many }) => ({
  project: one(projects, {
    fields: [faceIdentities.projectId],
    references: [projects.id]
  }),
  observations: many(faceObservations)
}));

export const faceObservationsRelations = relations(faceObservations, ({ one }) => ({
  project: one(projects, {
    fields: [faceObservations.projectId],
    references: [projects.id]
  }),
  document: one(documents, {
    fields: [faceObservations.documentId],
    references: [documents.id]
  }),
  artifact: one(documentArtifacts, {
    fields: [faceObservations.artifactId],
    references: [documentArtifacts.id]
  }),
  processingRun: one(processingRuns, {
    fields: [faceObservations.processingRunId],
    references: [processingRuns.id]
  }),
  identity: one(faceIdentities, {
    fields: [faceObservations.faceIdentityId],
    references: [faceIdentities.id]
  })
}));
