import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Goal as GoalService } from "@/session/goal"
import { Bus } from "@/bus"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"

const layer = Layer.mergeAll(
  GoalService.defaultLayer,
  Bus.layer,
  Session.defaultLayer,
  SyncEvent.defaultLayer,
)

const it = testEffect(layer)

afterEach(async () => {
  await disposeAllInstances()
})

describe("goal.set", () => {
  it.instance("inserts a goal row in the database", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Write tests", tokenBudget: 50000 })
    const goal = yield* svc.get(chat.id)
    expect(goal).toBeDefined()
    expect(goal!.objective).toBe("Write tests")
    expect(goal!.status).toBe("active")
    expect(goal!.tokenBudget).toBe(50000)
    expect(goal!.tokensUsed).toBe(0)
    expect(goal!.timeUsedSeconds).toBe(0)
  }))

  it.instance("overwrites existing goal with same sessionID", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "First goal", tokenBudget: 10000 })
    yield* svc.set({ sessionID: chat.id, objective: "Second goal", tokenBudget: 20000 })
    const goal = yield* svc.get(chat.id)
    expect(goal!.objective).toBe("Second goal")
    expect(goal!.tokenBudget).toBe(20000)
    expect(goal!.tokensUsed).toBe(0)
  }))
})

describe("goal.clear", () => {
  it.instance("removes goal row from database", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "To be cleared" })
    let goal = yield* svc.get(chat.id)
    expect(goal).toBeDefined()
    yield* svc.clear(chat.id)
    goal = yield* svc.get(chat.id)
    expect(goal).toBeUndefined()
  }))
})

describe("goal.updateStatus", () => {
  it.instance("updates goal status to complete", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Test status" })
    yield* svc.updateStatus({ sessionID: chat.id, status: "complete" })
    const goal = yield* svc.get(chat.id)
    expect(goal!.status).toBe("complete")
  }))

  it.instance("transitions to budget_limited", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Budget test", tokenBudget: 1000 })
    yield* svc.updateStatus({ sessionID: chat.id, status: "budget_limited" })
    const goal = yield* svc.get(chat.id)
    expect(goal!.status).toBe("budget_limited")
  }))
})

describe("goal.addTokens", () => {
  it.instance("increments tokensUsed and timeUsedSeconds", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Token test", tokenBudget: 50000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 1500, durationSeconds: 30 })
    const goal = yield* svc.get(chat.id)
    expect(goal!.tokensUsed).toBe(1500)
    expect(goal!.timeUsedSeconds).toBe(30)
  }))

  it.instance("multiple adds accumulate", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Accumulate test", tokenBudget: 50000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 1000, durationSeconds: 10 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 2000, durationSeconds: 20 })
    const goal = yield* svc.get(chat.id)
    expect(goal!.tokensUsed).toBe(3000)
    expect(goal!.timeUsedSeconds).toBe(30)
  }))

  it.instance("auto-transitions to budget_limited when tokens exceed budget", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Auto limit", tokenBudget: 1000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 500, durationSeconds: 10 })
    let goal = yield* svc.get(chat.id)
    expect(goal!.status).toBe("active")
    yield* svc.addTokens({ sessionID: chat.id, tokens: 600, durationSeconds: 10 })
    goal = yield* svc.get(chat.id)
    expect(goal!.status).toBe("budget_limited")
  }))
})

describe("goal.shouldContinue", () => {
  it.instance("returns shouldContinue=true when goal does not exist", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    // goal never set - should continue
    const result = yield* svc.shouldContinue(chat.id, 100)
    expect(result.shouldContinue).toBe(true)
    expect(result.budgetWarning).toBe(false)
    expect(result.budgetExhausted).toBe(false)
  }))

  it.instance("returns shouldContinue=false when goal is not active", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Paused goal" })
    yield* svc.updateStatus({ sessionID: chat.id, status: "paused" })
    const result = yield* svc.shouldContinue(chat.id, 100)
    expect(result.shouldContinue).toBe(false)
  }))

  it.instance("returns shouldContinue=true with no budget", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Unlimited goal" })
    const result = yield* svc.shouldContinue(chat.id, 1000)
    expect(result.shouldContinue).toBe(true)
    expect(result.budgetWarning).toBe(false)
    expect(result.budgetExhausted).toBe(false)
  }))

  it.instance("returns budgetWarning at 75% threshold", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Warning test", tokenBudget: 10000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 7000, durationSeconds: 60 })
    const result = yield* svc.shouldContinue(chat.id, 1000)
    expect(result.shouldContinue).toBe(true)
    expect(result.budgetWarning).toBe(true)
    expect(result.budgetExhausted).toBe(false)
  }))

  it.instance("returns budgetExhausted when estimated tokens exceed budget", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Exhaust test", tokenBudget: 10000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 5000, durationSeconds: 30 })
    const result = yield* svc.shouldContinue(chat.id, 6000)
    expect(result.shouldContinue).toBe(false)
    expect(result.budgetExhausted).toBe(true)
    expect(result.budgetWarning).toBe(false)
  }))

  it.instance("returns warning but not exhausted just above 75%", Effect.gen(function* () {
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "test-session" })
    const svc = yield* GoalService.Service
    yield* svc.set({ sessionID: chat.id, objective: "Just above 75%", tokenBudget: 10000 })
    yield* svc.addTokens({ sessionID: chat.id, tokens: 7000, durationSeconds: 60 })
    const result = yield* svc.shouldContinue(chat.id, 2000)
    expect(result.shouldContinue).toBe(true)
    expect(result.budgetWarning).toBe(true)
    expect(result.budgetExhausted).toBe(false)
  }))
})
