import { Goal } from "../session/goal"
import { SessionStatus } from "../session/status"
import type { Command, Info } from "./index"
import type { SessionID } from "../session/schema"
import { Effect } from "effect"

export const GOAL_COMMAND = "/goal"

export const goalCommandInfo: Info = {
  name: GOAL_COMMAND,
  description: "set a persistent goal — agent continues until objective is reached or budget exhausted",
  source: "command",
}

const GOAL_SUB_COMMANDS = ["create", "pause", "resume", "clear", "status"] as const
type GoalSubCommand = (typeof GOAL_SUB_COMMANDS)[number]

function isGoalSubCommand(cmd: string): cmd is GoalSubCommand {
  return (GOAL_SUB_COMMANDS as readonly string[]).includes(cmd)
}

export class GoalCommandError extends Error {
  readonly _tag = "GoalCommandError"
  constructor(message: string) {
    super(message)
    this.name = "GoalCommandError"
  }
}

export const GOAL_COMMAND_HANDLERS: Command = {
  info: goalCommandInfo,

  parse: (raw: string) => {
    const parts = raw.trim().split(/\s+/)
    const sub = parts[1]
    if (!sub || !isGoalSubCommand(sub)) {
      return {
        subcommand: null,
        description: `Subcommands: ${GOAL_SUB_COMMANDS.join(" | ")}`,
      }
    }

    const args = parts.slice(2).join(" ")

    switch (sub) {
      case "create":
        return {
          subcommand: "create",
          description: args ? `goal: ${args}` : "goal: (no objective provided)",
          args: args || null,
        }
      case "pause":
        return { subcommand: "pause", description: "pause active goal", args: null }
      case "resume":
        return { subcommand: "resume", description: "resume paused goal", args: null }
      case "clear":
        return { subcommand: "clear", description: "clear goal", args: null }
      case "status":
        return { subcommand: "status", description: "show goal status", args: null }
    }
  },

  execute: (ctx, parsed) => {
    return Effect.gen(function* () {
      const sessionID = ctx.session.id as SessionID

      if (!parsed || parsed.subcommand === null) {
        const current = yield* Goal.getActive(sessionID)
        if (!current) {
          yield* Effect.logInfo("No active goal. Usage: /goal create <objective> | /goal pause | /goal resume | /goal clear | /goal status")
        } else {
          const pct = current.token_budget
            ? Math.round((current.tokens_used / current.token_budget) * 100)
            : 0
          yield* Effect.logInfo(
            `[Goal] "${current.objective}" — ${current.status} — ${pct}% budget used (${current.tokens_used}/${current.token_budget ?? "?"})`,
          )
        }
        return
      }

      switch (parsed.subcommand) {
        case "create": {
          if (!parsed.args) {
            yield* Effect.logWarn("/goal create requires an objective. Example: /goal create Fix all bugs in module X")
            return
          }
          const goal = yield* Goal.create(sessionID, parsed.args)
          yield* Effect.logInfo(`[Goal] Created: "${goal.objective}" (id=${goal.id})`)
          yield* SessionStatus.setActive(sessionID)
          break
        }
        case "pause": {
          const updated = yield* Goal.updateStatus(sessionID, "paused")
          if (!updated) {
            yield* Effect.logWarn("No active goal to pause")
          } else {
            yield* Effect.logInfo(`[Goal] Paused: "${updated.objective}"`)
          }
          break
        }
        case "resume": {
          const updated = yield* Goal.updateStatus(sessionID, "active")
          if (!updated) {
            yield* Effect.logWarn("No paused goal to resume")
          } else {
            yield* Effect.logInfo(`[Goal] Resumed: "${updated.objective}"`)
            yield* SessionStatus.setActive(sessionID)
          }
          break
        }
        case "clear": {
          const cleared = yield* Goal.clear(sessionID)
          if (cleared) {
            yield* Effect.logInfo(`[Goal] Cleared: "${cleared.objective}"`)
          } else {
            yield* Effect.logInfo("[Goal] No goal to clear")
          }
          break
        }
        case "status": {
          const current = yield* Goal.getActive(sessionID)
          if (!current) {
            yield* Effect.logInfo("[Goal] No active goal")
          } else {
            const pct = current.token_budget
              ? Math.round((current.tokens_used / current.token_budget) * 100)
              : 0
            yield* Effect.logInfo(
              `[Goal] status=${current.status} | budget=${pct}% | tokens=${current.tokens_used}/${current.token_budget ?? "?"} | objective="${current.objective}"`,
            )
          }
          break
        }
      }
    })
  },
}
