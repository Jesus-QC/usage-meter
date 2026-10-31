import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-meter',
  component: 'Pane',
  requestId: 'usage-meter',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const RUN = {
  command: 'usage-meter',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const STALE = [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' }]

test('the command fetches fresh figures over the stale reading', async ($, on) => {
  let fetched = 0
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: STALE },
  }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => {
    fetched++
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          five_hour: { utilization: 64, resets_at: '2099-01-01T00:00:00Z' },
          seven_day: { utilization: 20, resets_at: '2099-01-02T00:00:00Z' },
        }),
      },
    }
  })

  await $.command.run(RUN)
  expect(fetched).toBeGreaterThan(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^36%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^80%$/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a failed fetch keeps the session reading', async ($, on) => {
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: STALE },
  }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }))

  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^90%$/ })).toBeTruthy()
  await ui.unmount()
})

test('after a 429 with retry-after, a second run does not fetch again', async ($, on) => {
  let fetched = 0
  // The back-off lives in the store, shared by every session.
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: STALE },
  }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => {
    fetched++
    return { value: { status: 429, ok: false, headers: { 'retry-after': '60' }, text: '' } }
  })

  await $.command.run(RUN)
  await $.command.run(RUN)
  expect(fetched).toBeLessThanOrEqual(1)
})

test('nothing new keeps the figures the pane had', async ($, on) => {
  let readings: typeof STALE = STALE
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: readings },
  }))
  on('session.authorize', () => ({ value: null }))

  await $.command.run(RUN)
  // A reload before any reply: the session has no readings yet.
  readings = []
  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^90%$/ })).toBeTruthy()
  await ui.unmount()
})

test('a new session with no reply yet shows the last saved figures', async ($, on) => {
  const saved = [
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2099-01-01T00:00:00Z' },
    // A window that reset since it was saved reads as unused.
    { kind: 'seven_day', percentUsed: 70, resetsAt: '2000-01-01T00:00:00Z' },
  ]
  on('store.get', (_, e) => ({ value: e.key === 'lastLimits' ? saved : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('session.authorize', () => ({ value: null }))

  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^70%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^100%$/ })).toBeTruthy()
    await ui.unmount()
  }
})

const OK_BODY = JSON.stringify({ five_hour: { utilization: 64, resets_at: '2099-01-01T00:00:00Z' } })

test('running the command skips the spacing and says when it was updated', async ($, on) => {
  let fetched = 0
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => (fetched++, { value: { status: 200, ok: true, headers: {}, text: OK_BODY } }))

  await $.command.run(RUN)
  const second = await $.command.run(RUN)
  expect(fetched).toBe(2)
  expect(JSON.stringify(second)).toContain('updated just now')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /updated just now/ })).toBeTruthy()
  await ui.unmount()
})

test('a 429 says when it retries, and holds back even a manual run', async ($, on) => {
  let fetched = 0
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: STALE } }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => (fetched++, { value: { status: 429, ok: false, headers: {}, text: '' } }))

  await $.command.run(RUN)
  await $.command.run(RUN)
  expect(fetched).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /rate limited, retrying in 15m/ })).toBeTruthy()
  await ui.unmount()
})

test('saved figures carry the time they were checked', async ($, on) => {
  const tenMinutesAgo = Date.now() - 10 * 60_000
  const saved = { at: tenMinutesAgo, limits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2099-01-01T00:00:00Z' }] }
  on('store.get', (_, e) => ({ value: e.key === 'lastLimits' ? saved : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.authorize', () => ({ value: null }))

  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^70%$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /updated 10m ago/ })).toBeTruthy()
    await ui.unmount()
  }
})
