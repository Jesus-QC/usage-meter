import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit } from '../types'

const PANE = 'usage-meter'
const TITLE = 'Usage'
const HOUR = 3_600_000

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
// Ticks every minute so the countdown and the pace marker move between turns.
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0, {
  shape: 'now-1',
})

const WINDOWS: Record<string, { label: string; ms?: number }> = {
  five_hour: { label: 'Session', ms: 5 * HOUR },
  seven_day: { label: 'Weekly', ms: 7 * 24 * HOUR },
  spend_limit: { label: 'Spend' },
}

const ORDER = ['five_hour', 'seven_day', 'spend_limit']

function untilReset(resetsAt: string | undefined, at: number) {
  if (!resetsAt) return undefined
  const ms = Math.max(0, Date.parse(resetsAt) - at)
  const m = Math.floor(ms / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m % 60}m`
}

// The share of the window still left if usage were spread evenly across it.
function evenLeft(limit: Limit, at: number) {
  const span = WINDOWS[limit.kind]?.ms
  if (!span || !limit.resetsAt) return undefined
  const remaining = Date.parse(limit.resetsAt) - at
  return Math.min(1, Math.max(0, remaining / span))
}

function barSvg(left: number, even: number | undefined, reset: string | undefined) {
  const W = 600
  const H = 32
  const fill = Math.round(W * left)
  const marker =
    even === undefined
      ? ''
      : `<rect x="${Math.round(W * even) - 2}" y="0" width="4" height="${H}" fill="#ffffff" stroke="#000" stroke-width="1"/>`
  const pill = reset
    ? `<g><rect x="${W - 86}" y="5" width="80" height="22" rx="4" fill="#1a1a1a" fill-opacity="0.9"/>` +
      `<text x="${W - 46}" y="20.5" font-family="-apple-system,system-ui,sans-serif" font-size="12" fill="#eee" text-anchor="middle">↻ ${reset}</text></g>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="8" stroke="#c96442" stroke-opacity="0.35" stroke-width="2"/></pattern>` +
    `<clipPath id="r"><rect width="${W}" height="${H}" rx="6"/></clipPath></defs>` +
    `<g clip-path="url(#r)">` +
    `<rect width="${W}" height="${H}" fill="#c96442" fill-opacity="0.08"/>` +
    `<rect width="${W}" height="${H}" fill="url(#hatch)"/>` +
    `<rect width="${fill}" height="${H}" fill="#7a3a2a"/>` +
    `</g>${marker}${pill}</svg>`
  )
}

function textBar(left: number, even: number | undefined, cells: number) {
  const width = Math.max(10, cells)
  const filled = Math.round(width * left)
  const mark = even === undefined ? -1 : Math.min(width - 1, Math.round(width * even))
  let bar = ''
  for (let i = 0; i < width; i++) bar += i === mark ? '│' : i < filled ? '█' : '░'
  return bar
}

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  await update($, limits, () =>
    usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-meter',
      description: 'Show usage left and time to reset in a pane',
    })
    await update($, now, () => Date.now())
    await refresh($)
    $.clock.every(60_000, () => update($, now, () => Date.now()))

    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () =>
        e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
      )
      await update($, now, () => Date.now())
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const list = [...(await read($, limits))].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    const at = (await read($, now)) || Date.now()

    if (list.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>No usage figures yet.</Text>
          <Text dimColor>They appear after the first reply on a Claude subscription.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {list.map(limit => {
          const label = WINDOWS[limit.kind]?.label ?? limit.kind
          const leftPct = Math.max(0, Math.round(100 - limit.percentUsed))
          const left = leftPct / 100
          const even = evenLeft(limit, at)
          const reset = untilReset(limit.resetsAt, at)
          const delta = even === undefined ? undefined : Math.round((left - even) * 100)
          const pace =
            delta === undefined
              ? undefined
              : delta >= 0
                ? `${delta}% ahead of even pace`
                : `${-delta}% behind even pace`

          return (
            <Box key={limit.kind} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold>{label}</Text>
                {reset && <Text dimColor>resets in {reset}</Text>}
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text bold color={delta !== undefined && delta < 0 ? 'warning' : undefined}>
                  {leftPct}%
                </Text>
                <Text dimColor>left</Text>
                {pace && <Text dimColor>· {pace}</Text>}
              </Box>
              {'Svg' in ui ? (
                <ui.Svg
                  source={barSvg(left, even, reset)}
                  alt={`${label}: ${leftPct}% left${reset ? `, resets in ${reset}` : ''}`}
                />
              ) : (
                <Text color="claude">{textBar(left, even, (e.props.bodyColumns ?? 40) - 6)}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
