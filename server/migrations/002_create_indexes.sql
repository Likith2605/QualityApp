-- Migration 002: Create Performance Indexes
-- Optimize query performance for search, foreign key lookups, and reporting

-- Drawing indexes
CREATE INDEX IF NOT EXISTS idx_drawings_drawing_no ON drawings (drawing_no);
CREATE INDEX IF NOT EXISTS idx_drawings_deleted ON drawings (deleted);
CREATE INDEX IF NOT EXISTS idx_drawings_created_by ON drawings (created_by);
CREATE INDEX IF NOT EXISTS idx_drawings_created_at ON drawings (created_at DESC);

-- Dimension indexes
CREATE INDEX IF NOT EXISTS idx_dimensions_drawing_id ON dimensions (drawing_id);
CREATE INDEX IF NOT EXISTS idx_dimensions_deleted ON dimensions (deleted);

-- Inspection / Check indexes
CREATE INDEX IF NOT EXISTS idx_checks_drawing_id ON checks (drawing_id);
CREATE INDEX IF NOT EXISTS idx_checks_checked_by ON checks (checked_by);
CREATE INDEX IF NOT EXISTS idx_checks_client_id ON checks (client_id);
CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_checks_deleted ON checks (deleted);

-- Measurements indexes
CREATE INDEX IF NOT EXISTS idx_measurements_check_id ON measurements (check_id);
CREATE INDEX IF NOT EXISTS idx_measurements_dimension_id ON measurements (dimension_id);

-- Dispatch indexes
CREATE INDEX IF NOT EXISTS idx_dispatches_drawing_id ON dispatches (drawing_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_dispatch_no ON dispatches (dispatch_no);
CREATE INDEX IF NOT EXISTS idx_dispatches_dispatched_at ON dispatches (dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_deleted ON dispatches (deleted);

-- Employee indexes
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees (employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_deleted ON employees (deleted);

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_employee_id ON sessions (employee_id);
