-- Migration 003: Attachments and File Metadata Table
-- Secure file & attachment storage tracking for blueprints, CAD drawings, and inspection documents

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  drawing_id INTEGER REFERENCES drawings(id) ON DELETE SET NULL ON UPDATE CASCADE,
  check_id INTEGER REFERENCES checks(id) ON DELETE SET NULL ON UPDATE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  file_size BIGINT NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,
  url_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attachments_drawing_id ON attachments (drawing_id);
CREATE INDEX IF NOT EXISTS idx_attachments_check_id ON attachments (check_id);
