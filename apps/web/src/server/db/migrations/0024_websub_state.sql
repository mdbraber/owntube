CREATE TABLE IF NOT EXISTS websub_state (
  id integer PRIMARY KEY CHECK (id = 1),
  ok_at integer NOT NULL DEFAULT 0,
  wanted integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 0,
  failing integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT OR IGNORE INTO websub_state (id, ok_at, wanted, active, failing) VALUES (1, 0, 0, 0, 0);
