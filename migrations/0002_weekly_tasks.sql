CREATE TABLE weekly_tasks (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT INTO weekly_tasks (id, content, updated_at) VALUES (1, '', datetime('now'));
