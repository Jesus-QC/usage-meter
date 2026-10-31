import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checked, Limit } from '../types'

const PANE = 'usage-meter'
const TITLE = 'Usage'
const HOUR = 3_600_000
// The endpoint /usage reads: fresh figures without waiting for the next reply.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [], {
  shape: 'limits-1',
})
// Ticks every minute so the countdown and the pace marker move between turns.
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0, {
  shape: 'now-1',
})
const checked = atom({ plugin: 'usage-meter', key: 'checked' } as const, { at: 0 } as Checked, {
  shape: 'checked-1',
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

type Mood = 'happy' | 'worried' | 'tired'

// The buddy reacts to the tightest window: nearly empty, behind pace, or fine.
function moodOf(list: readonly Limit[], at: number): Mood {
  let worst = 0
  for (const limit of list) {
    const left = Math.max(0, 100 - limit.percentUsed) / 100
    if (left < 0.1) return 'tired'
    const even = evenLeft(limit, at)
    if (even !== undefined) worst = Math.min(worst, left - even)
  }
  return worst < -0.05 ? 'worried' : 'happy'
}

const MOOD_LINE: Record<Mood, string> = {
  happy: 'Plenty of room. Cruising!',
  worried: 'Burning a bit faster than even pace…',
  tired: 'Running on fumes. Time for a break?',
}

// The welcome screen's crab, for surfaces that draw no SVG.
const CRAB = [' ▐▛███▜▌', '▝▜█████▛▘', '  ▘▘ ▝▝']

// The crab from Claude Code's welcome screen, one rect per pixel of its sprite:
// body x3..14 over rows 0-3, eyes at (5,1) and (12,1), claws on row 2, legs on row 4.
function crabSvg(mood: Mood) {
  const ink = '#1f1410'
  const body = '#d97757'
  // Terminal quadrant pixels are twice as tall as they are wide.
  const U = 5
  const H = 10
  const OX = 8
  const OY = 8
  const px = (x: number, y: number, fill = body, h = H, dy = 0) =>
    `<rect x="${OX + x * U}" y="${OY + y * H + dy}" width="${U}" height="${h}" fill="${fill}"/>`
  const span = (y: number, from: number, to: number, skip: number[] = []) => {
    let out = ''
    for (let x = from; x <= to; x++) if (!skip.includes(x)) out += px(x, y)
    return out
  }
  const torso = span(0, 3, 14) + span(1, 3, 14, [5, 12]) + span(2, 3, 14) + span(3, 3, 14)

  const blink = `<animate attributeName="fill" values="${ink};${ink};${body};${ink}" keyTimes="0;0.9;0.95;1" dur="3.6s" repeatCount="indefinite"/>`
  const eye = (x: number) =>
    mood === 'tired'
      ? px(x, 1) + px(x, 1, ink, 2.5, H / 2)
      : `<rect x="${OX + x * U}" y="${OY + H}" width="${U}" height="${H}" fill="${ink}">${blink}</rect>`

  const step = (dur: string, begin: string) =>
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${dur}" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
  const legDur = { happy: '0.5s', worried: '0.24s', tired: '0s' }[mood]
  const legs = (xs: number[], begin: string) =>
    `<g>${xs.map(x => px(x, 4)).join('')}${legDur === '0s' ? '' : step(legDur, begin)}</g>`

  const wave = (begin: string) =>
    mood === 'happy'
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${H / 2};0 0" dur="0.9s" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
      : ''
  const claws = `<g>${px(1, 2)}${px(2, 2)}${wave('0s')}</g><g>${px(15, 2)}${px(16, 2)}${wave('0.45s')}</g>`

  const move = {
    happy: `<animateTransform attributeName="transform" type="translate" values="0 0;3 -2;6 0;3 -2;0 0;-3 -2;-6 0;-3 -2;0 0" dur="3s" repeatCount="indefinite"/>`,
    worried: `<animateTransform attributeName="transform" type="translate" values="0 0;1.5 0;-1.5 0;0 0" dur="0.3s" repeatCount="indefinite"/>`,
    tired: `<animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0" dur="3.2s" repeatCount="indefinite"/>`,
  }[mood]

  const extra = {
    happy:
      `<g fill="#f3c08a"><rect x="4" y="4" width="3" height="3"><animate attributeName="opacity" values="0;1;0" dur="1.6s" repeatCount="indefinite"/></rect>` +
      `<rect x="93" y="10" width="3" height="3"><animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="0.8s" repeatCount="indefinite"/></rect></g>`,
    worried:
      `<path d="M86 6 q3 5 0 7 q-3 -2 0 -7z" fill="#7fb3ff">` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;0 12" dur="1.2s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="1;0" dur="1.2s" repeatCount="indefinite"/></path>`,
    tired: ['0s', '1.2s']
      .map(
        begin =>
          `<text x="84" y="14" font-family="-apple-system,system-ui,sans-serif" font-size="9" font-weight="700" fill="#b9a69c" opacity="0">z` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;6 -10" dur="2.4s" begin="${begin}" repeatCount="indefinite"/>` +
          `<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${begin}" repeatCount="indefinite"/></text>`,
      )
      .join(''),
  }[mood]

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="66" viewBox="0 0 100 66" shape-rendering="crispEdges">` +
    `<g>${move}${torso}${eye(5)}${eye(12)}${claws}${legs([4, 11], '0s')}${legs([6, 13], legDur === '0s' ? '0s' : `${parseFloat(legDur) / 2}s`)}</g>` +
    `${extra}</svg>`
  )
}

async function openPane($: EngineInterface) {
  // Run by hand: skip the 5-minute spacing, as t3code does, but not a 429 back-off.
  await refresh($, { manual: true })
  await $.ui.open({ id: PANE, title: TITLE })
  const list = await read($, limits)
  if (list.length === 0) return { text: 'Usage pane opened. Figures appear after the first reply.' }
  const at = Date.now()
  const mood = moodOf(list, at)

  // The row's text is the mood line, then when it was checked; the CommandOutput hook below draws the crab beside it.
  return { text: `${MOOD_LINE[mood]}${checkedLine(await read($, checked), at, ' · ')}` }
}

function ago(ms: number) {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`
}

// "updated 3m ago", and when a held-back fetch retries; empty when nothing is known.
function checkedLine(c: Checked, at: number, lead = '') {
  const parts: string[] = []
  if (c.at > 0) parts.push(`updated ${ago(Math.max(0, at - c.at))}`)
  if (c.retryAt && c.retryAt > at) parts.push(`rate limited, retrying in ${Math.ceil((c.retryAt - at) / 60_000)}m`)
  return parts.length > 0 ? lead + parts.join(' · ') : ''
}

// The endpoint rate-limits hard: automatic fetches go at most this often, and none during a 429 back-off.
const FETCH_EVERY = 5 * 60_000
const BACKOFF = 15 * 60_000
// Kept in $.store, shared by every session and kept across reloads: when the next automatic fetch
// may go out, how long a 429 holds every fetch back, and the last figures any session saw with
// when they were checked, so a fresh session starts with them.
const NEXT_FETCH_KEY = 'nextFetchAt'
const BLOCKED_KEY = 'blockedUntil'
const LAST_KEY = 'lastLimits'

async function storeNumber($: EngineInterface, key: string) {
  return Number(await $.store.get(key).catch(() => 0)) || 0
}

async function saveLast($: EngineInterface, list: Limit[], at: number) {
  if (list.length > 0) await $.store.set(LAST_KEY, { at, limits: list }).catch(() => undefined)
}

// The last figures saved and when; a window that has reset since reads as unused.
async function loadLast($: EngineInterface, at: number): Promise<{ at: number; limits: Limit[] }> {
  const saved = await $.store.get(LAST_KEY).catch(() => undefined)
  // 0.3.2 saved the bare list, with no time.
  const raw = Array.isArray(saved) ? saved : (saved as { limits?: unknown } | undefined)?.limits
  const savedAt = Array.isArray(saved) ? 0 : Number((saved as { at?: unknown } | undefined)?.at) || 0
  if (!Array.isArray(raw)) return { at: 0, limits: [] }
  const list = raw
    .filter((l): l is Limit => typeof l?.kind === 'string' && typeof l?.percentUsed === 'number')
    .map(l =>
      l.resetsAt && Date.parse(l.resetsAt) <= at
        ? { kind: l.kind, percentUsed: 0 }
        : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt },
    )
  return { at: savedAt, limits: list }
}

// Asks the usage endpoint directly; undefined off a subscription, while held back, or when the request fails.
async function fetchLimits($: EngineInterface, manual: boolean): Promise<Limit[] | undefined> {
  const at = Date.now()
  if (at < (await storeNumber($, BLOCKED_KEY))) return undefined
  if (!manual && at < (await storeNumber($, NEXT_FETCH_KEY))) return undefined
  await $.store.set(NEXT_FETCH_KEY, at + FETCH_EVERY).catch(() => undefined)
  const auth = await $.session.authorize().catch(() => null)
  if (auth?.kind !== 'bearer') return undefined
  const res = await $.http
    .fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    .catch(() => undefined)
  if (res?.status === 429) {
    const retryAfter = Number(res.headers['retry-after'] ?? res.headers['Retry-After'])
    const wait = Math.max(BACKOFF, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)
    await $.store.set(BLOCKED_KEY, at + wait).catch(() => undefined)
  }
  if (!res?.ok) return undefined
  let body: Record<string, { utilization?: unknown; resets_at?: unknown } | null>
  try {
    body = JSON.parse(res.text)
  } catch {
    return undefined
  }
  const list: Limit[] = []
  for (const kind of ['five_hour', 'seven_day']) {
    const w = body?.[kind]
    if (typeof w?.utilization !== 'number') continue
    list.push({
      kind,
      percentUsed: Math.round(w.utilization * 10) / 10,
      resetsAt: typeof w.resets_at === 'string' ? w.resets_at : undefined,
    })
  }
  return list.length > 0 ? list : undefined
}

// Fresh figures from the endpoint when it answers; else what the pane has, or the last saved ones.
async function refresh($: EngineInterface, { manual = false } = {}) {
  const at = Date.now()
  const fetched = await fetchLimits($, manual)
  const retryAt = await storeNumber($, BLOCKED_KEY)
  if (fetched) {
    // Windows the endpoint left out keep the session's reading.
    const fresh = new Set(fetched.map(l => l.kind))
    const usage = await $.session.usage()
    const list = [
      ...usage.rateLimits
        .filter(l => !fresh.has(l.kind))
        .map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
      ...fetched,
    ]
    await update($, limits, () => list)
    await update($, checked, () => ({ at }))
    await saveLast($, list, at)
    return
  }
  const current = await read($, checked)
  // A newer reading from another session (or before a reload) wins over what this one shows.
  const last = await loadLast($, at)
  if (last.limits.length > 0 && (last.at > current.at || (await read($, limits)).length === 0)) {
    await update($, limits, () => last.limits)
    await update($, checked, () => ({ at: last.at, retryAt: retryAt > at ? retryAt : undefined }))
    return
  }
  // Nothing shown or saved yet: the session's own reading, its time unknown.
  if ((await read($, limits)).length === 0) {
    const usage = await $.session.usage()
    const list = usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
    if (list.length > 0) await update($, limits, () => list)
  }
  await update($, checked, c => ({ at: c.at, retryAt: retryAt > at ? retryAt : undefined }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Where ~/.claude/commands/usage-meter.md exists (so the menu lists it before a chat
    // starts) the engine refuses this name; the command.run hook below answers that one.
    await $.command
      .register({
        name: 'usage-meter',
        description: 'Show usage left and time to reset in a pane',
      })
      .catch(() => undefined)
    await update($, now, () => Date.now())
    await refresh($)
    // Every minute: move the countdown and the "updated" line, and fetch when the spacing allows.
    $.clock.every(60_000, () => {
      void update($, now, () => Date.now())
      void refresh($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, $ => openPane($))

  on('ui.render', { component: 'CommandOutput', props: { command: 'usage-meter' } }, async ($, e, next) => {
    // The row's text arrives under the plugin's name ("usage-meter: …"), then the mood line and when it was checked.
    const text = e.props.text.trim()
    const mood = (Object.keys(MOOD_LINE) as Mood[]).find(m => text.includes(MOOD_LINE[m]))
    if (!mood) return next(e)
    const when = text.slice(text.indexOf(MOOD_LINE[mood]) + MOOD_LINE[mood].length).replace(/^ · /, '')
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        {'Svg' in ui ? (
          <ui.Svg source={crabSvg(mood)} alt={`Claude crab, ${mood}`} width={33} height={22} isInteractive />
        ) : (
          <Text color="claude">{CRAB[0]}</Text>
        )}
        <Text>{MOOD_LINE[mood]}</Text>
        {when && <Text dimColor>· {when}</Text>}
      </Box>
    )
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      const at = Date.now()
      const list = e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
      await update($, limits, () => list)
      await update($, checked, c => ({ at, retryAt: c.retryAt }))
      await saveLast($, list, at)
      await update($, now, () => at)
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

    const mood = moodOf(list, at)
    const when = checkedLine(await read($, checked), at)

    const cards = list.map(limit => {
      const label = WINDOWS[limit.kind]?.label ?? limit.kind
      const leftPct = Math.max(0, Math.round(100 - limit.percentUsed))
      const left = leftPct / 100
      const even = evenLeft(limit, at)
      const reset = untilReset(limit.resetsAt, at)
      const delta = even === undefined ? undefined : Math.round((left - even) * 100)
      const pace =
        delta === undefined ? undefined : delta >= 0 ? `${delta}% ahead of even pace` : `${-delta}% behind even pace`

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
    })

    // Desktop: usage on top, then the crab centred in the room left, its line beneath.
    // The column is stretched to the pane's own rows so that room reaches the bottom.
    if ('Svg' in ui) {
      const rows = e.props.scroll.bodyRows
      return (
        <Box flexDirection="column" gap={1} padding={1} minHeight={rows > 0 ? rows : '100%'}>
          {cards}
          <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" gap={1}>
            <ui.Svg source={crabSvg(mood)} alt={`Claude crab, ${mood}`} width={150} height={99} isInteractive />
            <Text dimColor>{MOOD_LINE[mood]}</Text>
            {when && <Text dimColor>{when}</Text>}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Box flexDirection="column">
            {CRAB.map(line => (
              <Text color="claude">{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text dimColor>{MOOD_LINE[mood]}</Text>
            {when && <Text dimColor>{when}</Text>}
          </Box>
        </Box>
        {cards}
      </Box>
    )
  })
}
