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

  return (
    <Show when={show()}>
      <box>
        <text fg={theme().text}>
          <b>Goal</b>
        </text>
        <text fg={color()}>
          {goal()!.objective}
        </text>
        <box flexDirection="row" gap={1}>
          <text fg={color()}>
            <b>{label()}</b>
          </text>
          <Show when={progressPercent() !== undefined}>
            <text fg={theme().textMuted}>
              {progressPercent()!}%
            </text>
          </Show>
        </box>
        <Show when={goal()!.tokenBudget}>
          <text fg={theme().textMuted}>
            {goal()!.tokensUsed.toLocaleString()}/{goal()!.tokenBudget!.toLocaleString()} tokens
          </text>
        </Show>
        <Show when={!goal()!.tokenBudget}>
          <text fg={theme().textMuted}>
            {goal()!.tokensUsed.toLocaleString()} tokens used
          </text>
        </Show>
        <Show when={goal()!.timeUsedSeconds > 0}>
          <text fg={theme().textMuted}>
            {Math.round(goal()!.timeUsedSeconds / 60)}m {Math.round(goal()!.timeUsedSeconds % 60)}s
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
