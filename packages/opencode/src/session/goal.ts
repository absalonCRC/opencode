import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { GoalTable } from "./goal.sql"

export const Status = Schema.Literals(["active", "complete", "paused", "budget_limited"])
export type Status = Schema.Schema.Type<typeof Status>

export const Info = Schema.Struct({
  objective: Schema.String,
  status: Status,
  tokenBudget: Schema.optional(Schema.Number).annotate({ description: "null means unlimited" }),
  tokensUsed: Schema.Number,
  timeUsedSeconds: Schema.Number,
})
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Set: BusEvent.define(
    "goal.set",
    Schema.Struct({
      sessionID: SessionID,
      objective: Schema.String,
      tokenBudget: Schema.optional(Schema.Number),
    }),
  ),
  Updated: BusEvent.define(
    "goal.updated",
    Schema.Struct({
      sessionID: SessionID,
      goal: Info,
    }),
  ),
  Cleared: BusEvent.define(
    "goal.cleared",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
  BudgetExhausted: BusEvent.define(
    "goal.budget_exhausted",
    Schema.Struct({
      sessionID: SessionID,
      tokensUsed: Schema.Number,
      tokenBudget: Schema.Number,
    }),
  ),
}

export interface Interface {
  readonly set: (input: { sessionID: SessionID; objective: string; tokenBudget?: number }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly updateStatus: (input: { sessionID: SessionID; status: Status }) => Effect.Effect<void>
  readonly addTokens: (input: { sessionID: SessionID; tokens: number; durationSeconds?: number }) => Effect.Effect<void>
  readonly shouldContinue: (sessionID: SessionID, stepTokens: number) => Effect.Effect<{
    shouldContinue: boolean
    budgetWarning: boolean
    budgetExhausted: boolean
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

const fromRow = (row: typeof GoalTable.$inferSelect): Info => ({
  objective: row.objective,
  status: row.status as Status,
  tokenBudget: row.token_budget ?? undefined,
  tokensUsed: row.tokens_used,
  timeUsedSeconds: row.time_used_seconds,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const set = Effect.fn("SessionGoal.set")(function* (input: {
      sessionID: SessionID
      objective: string
      tokenBudget?: number
    }) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(GoalTable)
            .values({
              session_id: input.sessionID,
              objective: input.objective,
              token_budget: input.tokenBudget ?? null,
            })
            .onConflictDoUpdate({
              target: GoalTable.session_id,
              set: {
                objective: input.objective,
                status: "active",
                token_budget: input.tokenBudget ?? null,
                tokens_used: 0,
                time_used_seconds: 0,
                time_updated: Date.now(),
              },
            })
            .run(),
        ),
      )
      yield* bus.publish(Event.Set, {
        sessionID: input.sessionID,
        objective: input.objective,
        tokenBudget: input.tokenBudget,
      })
    })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, sessionID)).get()),
      )
      if (!row) return undefined
      return fromRow(row)
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID) {
      yield* Effect.sync(() => Database.use((db) => db.delete(GoalTable).where(eq(GoalTable.session_id, sessionID)).run()))
      yield* bus.publish(Event.Cleared, { sessionID })
    })

    const updateStatus = Effect.fn("SessionGoal.updateStatus")(function* (input: {
      sessionID: SessionID
      status: Status
    }) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalTable)
            .set({ status: input.status, time_updated: Date.now() })
            .where(eq(GoalTable.session_id, input.sessionID))
            .run(),
        ),
      )
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, input.sessionID)).get()),
      )
      if (row) {
        yield* bus.publish(Event.Updated, { sessionID: input.sessionID, goal: fromRow(row) })
      }
    })

    const addTokens = Effect.fn("SessionGoal.addTokens")(function* (input: {
      sessionID: SessionID
      tokens: number
      durationSeconds?: number
    }) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, input.sessionID)).get()),
      )
      if (!row || row.status !== "active") return

      const newTokensUsed = row.tokens_used + input.tokens
      const newTimeUsed = row.time_used_seconds + (input.durationSeconds ?? 0)

      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(GoalTable)
            .set({
              tokens_used: newTokensUsed,
              time_used_seconds: newTimeUsed,
              time_updated: Date.now(),
            })
            .where(eq(GoalTable.session_id, input.sessionID))
            .run(),
        ),
      )

      if (row.token_budget && row.token_budget > 0 && newTokensUsed >= row.token_budget && row.tokens_used < row.token_budget) {
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(GoalTable)
              .set({ status: "budget_limited", time_updated: Date.now() })
              .where(eq(GoalTable.session_id, input.sessionID))
              .run(),
          ),
        )
        yield* bus.publish(Event.BudgetExhausted, {
          sessionID: input.sessionID,
          tokensUsed: newTokensUsed,
          tokenBudget: row.token_budget,
        })
      }

      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, input.sessionID)).get()),
      )
      if (updated) {
        yield* bus.publish(Event.Updated, { sessionID: input.sessionID, goal: fromRow(updated) })
      }
    })

    const shouldContinue = Effect.fn("SessionGoal.shouldContinue")(function* (sessionID: SessionID, stepTokens: number) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, sessionID)).get()),
      )
      if (!row) return { shouldContinue: true, budgetWarning: false, budgetExhausted: false }
      if (row.status !== "active") return { shouldContinue: false, budgetWarning: false, budgetExhausted: false }

      if (!row.token_budget) return { shouldContinue: true, budgetWarning: false, budgetExhausted: false }

      const totalEstimated = row.tokens_used + stepTokens
      const budgetWarning = totalEstimated >= row.token_budget * 0.75 && row.tokens_used < row.token_budget * 0.75
      const budgetExhausted = totalEstimated >= row.token_budget

      return {
        shouldContinue: !budgetExhausted,
        budgetWarning,
        budgetExhausted,
      }
    })

    return Service.of({ set, get, clear, updateStatus, addTokens, shouldContinue })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Goal from "./goal"
