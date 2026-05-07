import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"

const id = "internal:sidebar-goal"

const statusColors: Record<string, string> = {
  active: "accent",
  complete: "success",
  paused: "warning",
  budget_limited: "error",
}

const statusLabels: Record<string, string> = {
  active: "Active",
  complete: "Complete",
  paused: "Paused",
  budget_limited: "Budget Exhausted",
}

function progressBar(percent: number, width: number) {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled
  return "█".repeat(filled) + "░".repeat(empty)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const goal = createMemo(() => props.api.state.session.goal(props.session_id))
  const show = createMemo(() => goal() !== undefined)

  const color = createMemo(() => {
    const g = goal()
    if (!g) return theme().textMuted
    return theme()[statusColors[g.status] as keyof typeof theme] ?? theme().textMuted
  })

  const label = createMemo(() => {
    const g = goal()
    if (!g) return ""
    return statusLabels[g.status] ?? g.status
  })

  const progressPercent = createMemo(() => {
    const g = goal()
    if (!g?.tokenBudget || g.tokenBudget <= 0) return undefined
    return Math.round((g.tokensUsed / g.tokenBudget) * 100)
  })

  const budgetText = createMemo(() => {
    const g = goal()
    if (!g) return ""
    if (g.tokenBudget && g.tokenBudget > 0) {
      return `${g.tokensUsed.toLocaleString()}/${g.tokenBudget.toLocaleString()} tokens`
    }
    return `${g.tokensUsed.toLocaleString()} tokens used`
  })

  const timeText = createMemo(() => {
    const g = goal()
    if (!g || g.timeUsedSeconds <= 0) return ""
    const m = Math.floor(g.timeUsedSeconds / 60)
    const s = Math.round(g.timeUsedSeconds % 60)
    return `${m}m ${s}s`
  })

  return (
    <Show when={show()}>
      <box gap={1}>
        <box flexDirection="row" gap={1}>
          <text fg={color()}>▣</text>
          <text fg={theme().text}>
            <b>Goal</b>
          </text>
          <text fg={color()}>
            <span style={{ bold: true }}>{label()}</span>
          </text>
        </box>
        <text fg={theme().text} wrapMode="word">
          {goal()!.objective}
        </text>
        <Show when={progressPercent() !== undefined}>
          <box flexDirection="row" gap={1}>
            <text fg={color()}>
              {progressBar(progressPercent()!, 16)}
            </text>
            <text fg={theme().textMuted}>
              {progressPercent()!}%
            </text>
          </box>
        </Show>
        <box flexDirection="row" gap={1}>
          <text fg={theme().textMuted}>{budgetText()}</text>
          <Show when={timeText()}>
            <text fg={theme().textMuted}>· {timeText()}</text>
          </Show>
        </box>
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
