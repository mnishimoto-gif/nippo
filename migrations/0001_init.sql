CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('作業','MTG')),
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  start_at TEXT NOT NULL,
  end_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE memo (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT INTO memo (id, content, updated_at) VALUES (1, '', datetime('now'));

CREATE INDEX idx_time_logs_task_id ON time_logs(task_id);
CREATE INDEX idx_time_logs_start_at ON time_logs(start_at);
