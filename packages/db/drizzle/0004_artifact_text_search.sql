CREATE INDEX IF NOT EXISTS document_artifact_text_spans_content_fts_idx
  ON document_artifact_text_spans
  USING gin (to_tsvector('simple', content));
