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
