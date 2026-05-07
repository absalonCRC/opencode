import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "../storage/schema.sql"

export const GoalTable = sqliteTable(
  "goal",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    objective: text().notNull(),
    status: text({ mode: "json" }).$type<GoalStatus>().notNull().default("active"),
    token_budget: integer(),
    tokens_used: integer().notNull().default(0),
    constraints: text({ mode: "json" }).$type<GoalConstraints>(),
    started_at: integer(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [],
)

export type GoalStatus = "active" | "paused" | "complete" | "failed" | "budget_limited"

export type GoalConstraints = {
  file_scope?: string[]
  approval_override?: boolean
}
