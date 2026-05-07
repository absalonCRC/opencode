import { Database } from "@/storage/db"
import { eq, and } from "drizzle-orm"
import { GoalTable, type GoalStatus, type GoalConstraints } from "./goal.sql"
import { SessionID } from "./schema"
import { InstanceState } from "@/effect/instance-state"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Effect, Layer, Context, Schema } from "effect"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"

export const GoalInfo = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  objective: Schema.String,
  status: Schema.Literals(["active", "paused", "complete", "failed", "budget_limited"]),
  tokenBudget: optionalOmitUndefined(Schema.NonNegativeInt),
  tokensUsed: NonNegativeInt,
  constraints: optionalOmitUndefined(
    Schema.Struct({
      fileScope: optionalOmitUndefined(Schema.Array(Schema.String)),
      approvalOverride: optionalOmitUndefined(Schema.Boolean),
    }),
  ),
  startedAt: optionalOmitUndefined(Schema.NonNegativeInt),
  completedAt: optionalOmitUndefined(Schema.NonNegativeInt),
  timeCreated: NonNegativeInt,
  timeUpdated: NonNegativeInt,
})
  .annotate({ identifier: "Goal" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type GoalInfo = Schema.Schema.Type<typeof GoalInfo>

export const Event = {
  Updated: BusEvent.define(
    "goal.updated",
    Schema.Struct({
      sessionID: SessionID,
      goal: GoalInfo,
    }),
  ),
  Completed: BusEvent.define(
    "goal.completed",
    Schema.Struct({
      sessionID: SessionID,
      goal: GoalInfo,
    }),
  ),
  BudgetLimited: BusEvent.define(
    "goal.budget_limited",
    Schema.Struct({
      sessionID: SessionID,
      goal: GoalInfo,
      tokensUsed: NonNegativeInt,
      tokenBudget: NonNegativeInt,
    }),
  ),
}

export interface Interface {
  readonly create: (input: {
    sessionID: SessionID
    objective: string
    tokenBudget?: number
    constraints?: GoalConstraints
  }) => Effect.Effect<GoalInfo>
  readonly get: (sessionID: SessionID) => Effect.Effect<GoalInfo | undefined>
  readonly update: (
    sessionID: SessionID,
    input: {
      objective?: string
      status?: GoalStatus
      tokensUsed?: number
    },
  ) => Effect.Effect<GoalInfo | undefined>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly pause: (sessionID: SessionID) => Effect.Effect<GoalInfo | undefined>
  readonly resume: (sessionID: SessionID) => Effect.Effect<GoalInfo | undefined>
  readonly complete: (sessionID: SessionID) => Effect.Effect<GoalInfo | undefined>
  readonly fail: (sessionID: SessionID, reason?: string) => Effect.Effect<GoalInfo | undefined>
  readonly setBudgetLimited: (sessionID: SessionID) => Effect.Effect<GoalInfo | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Goal") {}

export const layer: Layer.Layer<Service, never, Database.Service | Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database.Service
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("Goal.state")(() => Effect.succeed(new Map<SessionID, GoalInfo>())),
    )

    const toInfo = (row: typeof GoalTable.$inferSelect): GoalInfo => ({
      id: row.id,
      sessionID: row.session_id,
      objective: row.objective,
      status: row.status,
      tokenBudget: row.token_budget ?? undefined,
      tokensUsed: row.tokens_used,
      constraints:
        row.constraints
          ? {
              fileScope: row.constraints.file_scope,
              approvalOverride: row.constraints.approval_override,
            }
          : undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    })

    const create = Effect.fn("Goal.create")(function* (input: {
      sessionID: SessionID
      objective: string
      tokenBudget?: number
      constraints?: GoalConstraints
    }) {
      const existing = yield* db.query.row(
        GoalTable,
        eq(GoalTable.session_id, input.sessionID),
      )
      if (existing) {
        yield* db.query.remove(GoalTable, eq(GoalTable.session_id, input.sessionID))
      }

      const now = Date.now()
      const id = `goal_${now}_${Math.random().toString(36).slice(2, 9)}`
      const row: typeof GoalTable.$inferInsert = {
        id,
        session_id: input.sessionID,
        objective: input.objective,
        status: "active",
        token_budget: input.tokenBudget ?? null,
        tokens_used: 0,
        constraints: input.constraints ?? null,
        started_at: now,
        time_created: now,
        time_updated: now,
      }

      yield* db.query.insert(GoalTable, row)
      const info = toInfo(row)

      yield* state.pipe(
        Effect.flatMap((s) => Effect.succeed(s.set(input.sessionID, info))),
      )
      yield* bus.publish(Event.Updated, { sessionID: input.sessionID, goal: info })
      return info
    })

    const get = Effect.fn("Goal.get")(function* (sessionID: SessionID) {
      const cached = yield* state.pipe(Effect.flatMap((s) => Effect.succeed(s.get(sessionID))))
      if (cached) return cached

      const row = yield* db.query.row(GoalTable, eq(GoalTable.session_id, sessionID))
      if (!row) return
      const info = toInfo(row)
      yield* state.pipe(Effect.flatMap((s) => Effect.succeed(s.set(sessionID, info))))
      return info
    })

    const update = Effect.fn("Goal.update")(function* (
      sessionID: SessionID,
      input: {
        objective?: string
        status?: GoalStatus
        tokensUsed?: number
      },
    ) {
      const existing = yield* db.query.row(GoalTable, eq(GoalTable.session_id, sessionID))
      if (!existing) return

      const now = Date.now()
      const updates: Partial<typeof GoalTable.$inferInsert> = { time_updated: now }
      if (input.objective !== undefined) updates.objective = input.objective
      if (input.status !== undefined) {
        updates.status = input.status
        if (input.status === "complete" || input.status === "failed" || input.status === "budget_limited") {
          updates.completed_at = now
        }
      }
      if (input.tokensUsed !== undefined) updates.tokens_used = input.tokensUsed

      yield* db.query.update(GoalTable, eq(GoalTable.session_id, sessionID), updates)
      const updated = yield* db.query.row(GoalTable, eq(GoalTable.session_id, sessionID))
      if (!updated) return
      const info = toInfo(updated)
      yield* state.pipe(Effect.flatMap((s) => Effect.succeed(s.set(sessionID, info))))
      yield* bus.publish(Event.Updated, { sessionID, goal: info })

      if (info.status === "complete") {
        yield* bus.publish(Event.Completed, { sessionID, goal: info })
      } else if (info.status === "budget_limited") {
        yield* bus.publish(Event.BudgetLimited, {
          sessionID,
          goal: info,
          tokensUsed: info.tokensUsed,
          tokenBudget: info.tokenBudget ?? 0,
        })
      }

      return info
    })

    const clear = Effect.fn("Goal.clear")(function* (sessionID: SessionID) {
      yield* db.query.remove(GoalTable, eq(GoalTable.session_id, sessionID))
      yield* state.pipe(Effect.flatMap((s) => Effect.succeed(s.delete(sessionID))))
    })

    const pause = Effect.fn("Goal.pause")(function* (sessionID: SessionID) {
      return yield* update(sessionID, { status: "paused" })
    })

    const resume = Effect.fn("Goal.resume")(function* (sessionID: SessionID) {
      return yield* update(sessionID, { status: "active" })
    })

    const complete = Effect.fn("Goal.complete")(function* (sessionID: SessionID) {
      return yield* update(sessionID, { status: "complete" })
    })

    const fail = Effect.fn("Goal.fail")(function* (sessionID: SessionID, _reason?: string) {
      return yield* update(sessionID, { status: "failed" })
    })

    const setBudgetLimited = Effect.fn("Goal.setBudgetLimited")(function* (sessionID: SessionID) {
      return yield* update(sessionID, { status: "budget_limited" })
    })

    return Service.of({ create, get, update, clear, pause, resume, complete, fail, setBudgetLimited })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Bus.layer),
)

export * as Goal from "./goal"
