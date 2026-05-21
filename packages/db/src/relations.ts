import { relations } from "drizzle-orm";
import {
  accessTokenProjectScopes,
  accessTokens,
  attachments,
  chunkVectorEmbeddings,
  chunks,
  documents,
  memoryClaims,
  messages,
  peers,
  processingJobs,
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
  chunkVectorEmbeddings: many(chunkVectorEmbeddings)
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
