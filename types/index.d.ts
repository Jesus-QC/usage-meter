export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// When the figures were last confirmed (0 when unknown), and when a held-back fetch may retry.
export type Checked = { at: number; retryAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { limits: Shaped<Limit[]>; now: Shaped<number>; checked: Shaped<Checked> }
  }
}
