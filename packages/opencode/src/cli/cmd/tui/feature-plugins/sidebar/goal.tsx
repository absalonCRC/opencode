import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"

const id = "internal:sidebar-goal"

const statusConfig: Record<
  string,
  { color: "accent" | "success" | "warning" | "error"; label: string; icon: string }
> = {
  active: { color: "accent", label: "Active", icon: "▣" },
  complete: { color: "success", label: "Complete", icon: "✓" },
  paused: { color: "warning", label: "Paused", icon: "⏸" },
  budget_limited: { color: "error", label: "Budget", icon: "!" },
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const goal = createMemo(() => props.api.state.session.goal(props.session_id))
  const show = createMemo(() => goal() !== undefined)

  const [tick, setTick] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(false)

  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    onCleanup(() => clearInterval(id))
  })

  // Proxy subscribes to tick so goal re-evaluates every second
  const goalProxy = createMemo(() => {
    tick()
    return goal()
  })

  const cfg = createMemo(() => {
    const g = goalProxy()
    if (!g) return undefined
    return statusConfig[g.status] ?? statusConfig.active
  })

  const progress = createMemo((): number | undefined => {
    const g = goalProxy()
    if (!g?.tokenBudget || g.tokenBudget <= 0) return undefined
    const pct = Math.min(100, Math.round((g.tokensUsed / g.tokenBudget) * 100))
    return pct
  })

  const rate = createMemo((): number | undefined => {
    const g = goalProxy()
    if (!g || g.timeUsedSeconds < 5) return undefined
    return Math.round(g.tokensUsed / g.timeUsedSeconds)
  })

  const eta = createMemo((): number | undefined => {
    const g = goalProxy()
    const p = progress()
    const r = rate()
    if (!g || !g.tokenBudget || g.tokenBudget <= 0 || !r || r <= 0 || p === undefined) return undefined
    const remaining = g.tokenBudget - g.tokensUsed
    if (remaining <= 0) return 0
    return Math.round(remaining / r)
  })

  const budgetText = createMemo(() => {
    const g = goalProxy()
    if (!g) return ""
    if (g.tokenBudget && g.tokenBudget > 0) {
      return `${formatTokens(g.tokensUsed)} / ${formatTokens(g.tokenBudget)} tokens`
    }
    return `${formatTokens(g.tokensUsed)} tokens`
  })

  const rateText = createMemo(() => {
    const r = rate()
    if (!r) return ""
    return `${formatTokens(r)}/s`
  })

  const etaText = createMemo(() => {
    const e = eta()
    if (e === undefined) return ""
    if (e === 0) return "soon"
    return `~${formatDuration(e)} left`
  })

  const progressColor = createMemo(() => {
    const p = progress()
    if (p === undefined) return theme().accent
    if (p >= 90) return theme().error
    if (p >= 75) return theme().warning
    return theme().accent
  })

  const progressBarStr = createMemo(() => {
    const p = progress()
    if (p === undefined) return ""
    const filled = Math.round(p / 100 * 20)
    return "█".repeat(filled) + "░".repeat(20 - filled)
  })

  return (
    <Show when={show()}>
      <box gap={1}>
        {/* Header — clickable to collapse */}
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => setCollapsed((c) => !c)}
        >
          <text fg={theme().text}>{collapsed() ? "▶" : "▼"}</text>
          <text fg={theme().text}>
            <b>Goal</b>
          </text>
          <Show when={cfg()}>
            {(c) => (
              <text fg={theme()[c().color]}>
                <b>{c().icon} {c().label}</b>
              </text>
            )}
          </Show>
        </box>

        <Show when={!collapsed()}>
          {/* ⏱ Time + rate + ETA */}
          <box flexDirection="row" gap={1}>
            <text fg={theme().textMuted}>⏱</text>
            <text fg={theme().text}>{formatDuration(goalProxy()!.timeUsedSeconds)}</text>
            <Show when={rateText()}>
              <text fg={theme().textMuted}>· {rateText()}</text>
            </Show>
            <Show when={etaText()}>
              <text fg={theme().textMuted}>· {etaText()}</text>
            </Show>
          </box>

          {/* ◎ Token budget */}
          <box flexDirection="row" gap={1}>
            <text fg={theme().textMuted}>◎</text>
            <text fg={theme().text}>{budgetText()}</text>
          </box>

          {/* Progress bar */}
          <Show when={progress() !== undefined}>
            <box flexDirection="row" gap={1}>
              <text fg={progressColor()}>{progressBarStr()}</text>
              <text fg={theme().textMuted}>{progress()}%</text>
            </box>
          </Show>

          {/* Objective */}
          <text fg={theme().textMuted} wrapMode="word">
            {goalProxy()!.objective}
          </text>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
