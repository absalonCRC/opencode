import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  // Goal — raw store value
  const goal = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return sync.session.goal(route.data.sessionID)
  })

  // Goal with live elapsed time (ticks every second)
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    onCleanup(() => clearInterval(id))
  })

  const goalProxy = createMemo(() => {
    tick() // subscribe to tick to force re-evaluation
    const g = goal()
    if (!g) return undefined
    // liveSeconds = recorded seconds + seconds since last DB update
    const liveSeconds = g.timeUsedSeconds + Math.floor((Date.now() - g._updated) / 1000)
    return { ...g, liveSeconds }
  })

  const goalColor = createMemo(() => {
    const g = goal()
    if (!g) return undefined
    switch (g.status) {
      case "active":
        return theme.accent
      case "complete":
        return theme.success
      case "paused":
        return theme.warning
      case "budget_limited":
        return theme.error
    }
  })

  const goalLabel = createMemo(() => {
    const g = goal()
    if (!g) return undefined
    const base = g.status === "active" ? "Goal" : g.status === "complete" ? "Goal ✓" : `Goal (${g.status})`
    return base
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick_fn() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick_fn(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick_fn(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick_fn(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Show when={goalProxy()}>
          {(g) => (
            <>
              <text fg={goalColor()}>▣</text>
              <text fg={goalColor()}>
                <b>{goalLabel()}</b>
              </text>
              <text fg={theme.textMuted}>{formatDuration(g().liveSeconds)}</text>
            </>
          )}
        </Show>
        <Show when={!goalProxy()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
      </box>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
