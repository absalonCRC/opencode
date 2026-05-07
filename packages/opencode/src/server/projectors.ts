import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq, sql } from "drizzle-orm"
import { GoalTable } from "@/storage/schema"
import type { Info as GoalInfo } from "@/session/goal"
import { fromRow as goalFromRow } from "@/session/goal"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as SyncEvent.Event<typeof Session.Event.Updated>["data"]).sessionID
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())

        if (!row) return data

        return {
          sessionID: id,
          info: Session.fromRow(row),
        }
      }
      if (type === "goal.set" || type === "goal.updated") {
        const sessionID = (data as { sessionID: string }).sessionID
        const row = Database.use((db) =>
          db.select().from(GoalTable).where(sql`${GoalTable.session_id} = ${sessionID}`).get(),
        )
        if (!row) return { sessionID, goal: null as GoalInfo | null }
        return { sessionID, goal: goalFromRow(row) }
      }
      if (type === "goal.cleared") {
        return data
      }
      return data
    },
  })
}

initProjectors()
