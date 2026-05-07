import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./goal.txt"
import { Goal } from "../session/goal"

const UpdateGoalParameters = Schema.Struct({
  objective: Schema.optional(Schema.String).annotate({ description: "The goal description. Set to set or change the goal. Omit to leave unchanged." }),
  status: Schema.optional(Goal.Status).annotate({ description: "Goal status: active (working), complete (achieved), paused (stopped). Defaults to active when setting a new objective." }),
  token_budget: Schema.optional(Schema.Number).annotate({ description: "Maximum tokens to spend on this goal. Omit for unlimited budget." }),
})

type UpdateGoalMetadata = {
  goal?: Goal.Info
}

export const UpdateGoalTool = Tool.define<typeof UpdateGoalParameters, UpdateGoalMetadata, Goal.Service>(
  "update_goal",
  Effect.gen(function* () {
    const goal = yield* Goal.Service

    return {
      description: DESCRIPTION,
      parameters: UpdateGoalParameters,
      execute: (params: Schema.Schema.Type<typeof UpdateGoalParameters>, ctx: Tool.Context<UpdateGoalMetadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "update_goal",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const sessionID = ctx.sessionID

          if (params.objective) {
            yield* goal.set({
              sessionID,
              objective: params.objective,
              tokenBudget: params.token_budget,
            })
          } else if (params.status) {
            yield* goal.updateStatus({ sessionID, status: params.status })
          } else if (params.token_budget !== undefined) {
            const existing = yield* goal.get(sessionID)
            if (existing) {
              yield* goal.set({
                sessionID,
                objective: existing.objective,
                tokenBudget: params.token_budget,
              })
            }
          }

          const goalInfo = yield* goal.get(sessionID)

          if (!goalInfo) {
            return {
              title: "No goal set",
              output: "No goal is currently active. Provide an objective to set one.",
              metadata: {},
            }
          }

          const budgetStatus = goalInfo.tokenBudget
            ? `${goalInfo.tokensUsed}/${goalInfo.tokenBudget} tokens (${Math.round((goalInfo.tokensUsed / goalInfo.tokenBudget) * 100)}%)`
            : `${goalInfo.tokensUsed} tokens used (unlimited budget)`

          return {
            title: `Goal: ${goalInfo.status}`,
            output: [
              `Objective: ${goalInfo.objective}`,
              `Status: ${goalInfo.status}`,
              `Budget: ${budgetStatus}`,
              `Time: ${Math.round(goalInfo.timeUsedSeconds / 60)}m`,
            ].join("\n"),
            metadata: { goal: goalInfo },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof UpdateGoalParameters, UpdateGoalMetadata>
  }),
)

const GoalStatusParameters = Schema.Struct({})

type GoalStatusMetadata = {
  goal?: Goal.Info
}

export const GoalStatusTool = Tool.define<typeof GoalStatusParameters, GoalStatusMetadata, Goal.Service>(
  "goal_status",
  Effect.gen(function* () {
    const goal = yield* Goal.Service

    return {
      description: "Check the current goal status, including objective, progress, and token budget.",
      parameters: GoalStatusParameters,
      execute: (_params: Schema.Schema.Type<typeof GoalStatusParameters>, ctx: Tool.Context<GoalStatusMetadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "goal_status",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const sessionID = ctx.sessionID
          const goalInfo = yield* goal.get(sessionID)

          if (!goalInfo) {
            return {
              title: "No active goal",
              output: "No goal is currently active. Use update_goal with an objective to set one.",
              metadata: {},
            }
          }

          const budgetStatus = goalInfo.tokenBudget
            ? `${goalInfo.tokensUsed}/${goalInfo.tokenBudget} tokens (${Math.round((goalInfo.tokensUsed / goalInfo.tokenBudget) * 100)}%)`
            : `${goalInfo.tokensUsed} tokens used (unlimited budget)`

          return {
            title: goalInfo.status === "complete" ? "Goal Complete" : "Goal Active",
            output: [
              `Objective: ${goalInfo.objective}`,
              `Status: ${goalInfo.status}`,
              `Budget: ${budgetStatus}`,
              `Time: ${Math.round(goalInfo.timeUsedSeconds / 60)}m ${Math.round(goalInfo.timeUsedSeconds % 60)}s`,
            ].join("\n"),
            metadata: { goal: goalInfo },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof GoalStatusParameters, GoalStatusMetadata>
  }),
)
