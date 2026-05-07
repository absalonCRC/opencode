import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import type { SessionID } from "./schema"
import { Timestamps } from "../storage/schema.sql"

export const GoalTable = sqliteTable(
  "goal",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    objective: text().notNull(),
    status: text().notNull().$default(() => "active"),
    token_budget: integer(),
    tokens_used: integer().notNull().$default(() => 0),
    time_used_seconds: integer().notNull().$default(() => 0),
    ...Timestamps,
  },
  (table) => [
    index("goal_session_idx").on(table.session_id),
  ],
)
