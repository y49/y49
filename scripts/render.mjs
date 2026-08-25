#!/usr/bin/env node
// Turns data/profile.json into the SVGs the README embeds.
// Everything is hand-drawn: no chart library, no third-party badge service.

import { readFile, writeFile } from 'node:fs/promises'

const W = 840
const MONO = "ui-monospace,'SFMono-Regular','SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace"

// Every glyph is pinned to a 0.6em advance via textLength, so the layout is
// identical on a machine with Consolas and one with Menlo, and all the geometry
// below can be computed from column counts alone.
const ch = size => size * 0.6

// CJK and other fullwidth glyphs occupy two columns in a terminal, and PR
// titles pulled from the API may contain them.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/
const cols = s => [...s].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0)

function clamp (s, max) {
  if (cols(s) <= max) return s
  let out = ''
  for (const c of s) {
    if (cols(out) + cols(c) > max - 1) break
    out += c
  }
  return out + '…'
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - cols(s)))
const kilo = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

const THEMES = {
  light: {
    chrome: '#f6f8fa', body: '#ffffff', border: '#d1d9e0',
    fg: '#1f2328', muted: '#59636e', faint: '#818b98',
    green: '#1a7f37', blue: '#0969da', amber: '#9a6700', accent: '#8250df',
    grid: '#eaeef2'
  },
  dark: {
    chrome: '#161b22', body: '#0d1117', border: '#30363d',
    fg: '#e6edf3', muted: '#8b949e', faint: '#6e7681',
    green: '#3fb950', blue: '#58a6ff', amber: '#d29922', accent: '#a371f7',
    grid: '#21262d'
  }
}

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A text run with its width fixed, so callers can chain runs along one line.
// xml:space keeps the leading and trailing spaces that carry the alignment.
function run (text, x, y, { size = 15, fill, weight = 400, anchor, cls } = {}) {
  const w = cols(text) * ch(size)
  const attrs = [
    `x="${typeof x === 'number' ? x.toFixed(1) : x}"`,
    `y="${y.toFixed(1)}"`,
    `font-size="${size}"`,
    `textLength="${w.toFixed(1)}"`,
    'lengthAdjust="spacing"',
    'xml:space="preserve"',
    fill && `fill="${fill}"`,
    weight !== 400 && `font-weight="${weight}"`,
    anchor && `text-anchor="${anchor}"`,
    cls && `class="${cls}"`
  ].filter(Boolean).join(' ')
  return { svg: `<text ${attrs}>${esc(text)}</text>`, w }
}

/* ── hero: a terminal session that types itself out ─────────────────── */

function hero (data, t) {
  const { featured, upstream, user } = data

  // Upstream work is the strongest single credential here, so it goes in the
  // session rather than in a footnote. Columns are padded to line up.
  const upstreamRows = upstream.slice(0, 3).map(u => {
    const title = clamp(u.title.replace(/^\w+(\([^)]*\))?!?:\s*/, ''), 52)
    return [
      [pad(u.slug, 18), t.blue],
      [pad(`#${u.number}`, 8), t.faint],
      [pad(`★${kilo(u.stars)}`, 8), t.amber],
      [title, t.muted]
    ]
  })

  const session = [
    {
      cmd: 'whoami',
      out: [
        [['49', t.fg, 700], [' — backend & AI agent tooling', t.muted]],
        [['Go · TypeScript · self-hosted infra', t.muted]]
      ]
    },
    {
      cmd: 'ls ~/ships | wc -l',
      out: [[['1', t.amber, 700], ['    # not a typo', t.faint]]]
    },
    {
      cmd: 'why',
      out: [[
        [`${featured.releases} releases`, t.green, 700],
        [` in ${featured.releaseSpanDays} days — depth over count.`, t.muted]
      ]]
    },
    {
      cmd: 'git log --author=49 --remotes=upstream --oneline',
      out: upstreamRows
    },
    {
      cmd: 'cat ~/.taste',
      out: [[['code · whodunits · anime', t.muted]]]
    }
  ]

  const PAD = 26
  const BAR = 38
  const LH = 25
  const SIZE = 15
  const CW = ch(SIZE)
  const PROMPT = '~ $ '

  const body = []
  const css = []
  let time = 0.35
  let y = BAR + 34
  let line = 0

  for (const step of session) {
    const cx = PAD + PROMPT.length * CW
    const cmdW = cols(step.cmd) * CW
    const dur = +(cols(step.cmd) * 0.032).toFixed(2)
    const id = `t${line}`

    body.push(
      run(PROMPT, PAD, y, { size: SIZE, fill: t.green }).svg,
      `<g clip-path="url(#${id})">${run(step.cmd, cx, y, { size: SIZE, fill: t.fg }).svg}</g>`,
      `<clipPath id="${id}"><rect x="${cx.toFixed(1)}" y="${(y - SIZE).toFixed(1)}" ` +
      `width="0" height="${SIZE + 6}" class="${id}"/></clipPath>`,
      // The caret rides along the line as it is typed, then hands off.
      `<rect class="caret ${id}c" x="${cx.toFixed(1)}" y="${(y - SIZE + 2).toFixed(1)}" ` +
      `width="${CW.toFixed(1)}" height="${SIZE + 2}" fill="${t.fg}" opacity="0"/>`
    )
    css.push(
      `@keyframes k${id}{to{width:${cmdW.toFixed(1)}px}}`,
      `.${id}{animation:k${id} ${dur}s steps(${cols(step.cmd)}) ${time.toFixed(2)}s forwards}`,
      `@keyframes c${id}{to{transform:translateX(${cmdW.toFixed(1)}px)}}`,
      `.${id}c{animation:c${id} ${dur}s steps(${cols(step.cmd)}) ${time.toFixed(2)}s forwards,` +
      `show .01s linear ${time.toFixed(2)}s forwards,` +
      `hide .01s linear ${(time + dur).toFixed(2)}s forwards}`
    )

    time += dur + 0.1
    y += LH
    line++

    for (const parts of step.out) {
      let x = PAD
      const chunks = []
      for (const [text, fill, weight] of parts) {
        const r = run(text, x, y, { size: SIZE, fill, weight })
        chunks.push(r.svg)
        x += r.w
      }
      body.push(`<g class="o${line}" opacity="0">${chunks.join('')}</g>`)
      css.push(`.o${line}{animation:show .01s linear ${time.toFixed(2)}s forwards}`)
      time += 0.07
      y += LH
      line++
    }

    time += 0.28
    y += 10
  }

  // Resting prompt: the page keeps breathing after the session finishes.
  body.push(
    run(PROMPT, PAD, y, { size: SIZE, fill: t.green }).svg,
    `<rect class="rest" x="${(PAD + PROMPT.length * CW).toFixed(1)}" ` +
    `y="${(y - SIZE + 2).toFixed(1)}" width="${CW.toFixed(1)}" height="${SIZE + 2}" ` +
    `fill="${t.fg}" opacity="0"/>`
  )
  css.push(`.rest{animation:blink 1.06s steps(1) ${time.toFixed(2)}s infinite}`)

  const H = y + PAD + 6

  return frame(W, H, t, `
  <style>
    text{font-family:${MONO}}
    @keyframes show{to{opacity:1}}
    @keyframes hide{to{opacity:0}}
    @keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}
    ${css.join('')}
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"
        fill="${t.body}" stroke="${t.border}"/>
  <path d="M0.5 10.5a10 10 0 0 1 10-10h${W - 21}a10 10 0 0 1 10 10V${BAR}H0.5Z"
        fill="${t.chrome}" stroke="${t.border}"/>
  <circle cx="24" cy="19" r="5.5" fill="#ff5f57"/>
  <circle cx="43" cy="19" r="5.5" fill="#febc2e"/>
  <circle cx="62" cy="19" r="5.5" fill="#28c840"/>
  ${run(`${user.login}@github: ~`, W / 2, 24, { size: 13, fill: t.faint, anchor: 'middle' }).svg}
  ${body.join('\n  ')}`)
}

/* ── card: the one project that matters, and how it grew ─────────────── */

function wrap (text, max) {
  const lines = ['']
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const next = lines.at(-1) ? `${lines.at(-1)} ${word}` : word
    if (cols(next) <= max) lines[lines.length - 1] = next
    else lines.push(word)
  }
  return lines
}

function card (data, t) {
  const { featured, stars } = data
  const PAD = 26
  const inner = W - PAD * 2
  const parts = []

  let y = 44
  parts.push(
    `<circle cx="${PAD + 6}" cy="${y - 7}" r="5" fill="${t.blue}"/>`,
    run(featured.name, PAD + 20, y, { size: 24, fill: t.fg, weight: 700 }).svg,
    run(featured.language ?? '', W - PAD, y, { size: 13, fill: t.faint, anchor: 'end' }).svg
  )

  // Straight from the repo description, so the card cannot drift out of date.
  y += 34
  for (const l of wrap(featured.description, Math.floor(inner / ch(14))).slice(0, 2)) {
    parts.push(run(l, PAD, y, { size: 14, fill: t.muted }).svg)
    y += 21
  }

  y += 2
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${t.grid}"/>`)

  const metrics = [
    [String(featured.stars), 'stars'],
    [String(featured.forks), 'forks'],
    [String(featured.releases), 'releases'],
    [String(featured.mergedPrs), 'merged PRs'],
    [`${featured.daysPerRelease}d`, 'ship cadence']
  ]
  const cellW = inner / metrics.length
  y += 32
  for (const [i, [value, label]] of metrics.entries()) {
    const cx = PAD + cellW * i + cellW / 2
    parts.push(
      run(value, cx, y, { size: 27, fill: t.fg, weight: 700, anchor: 'middle' }).svg,
      run(label, cx, y + 20, { size: 11, fill: t.faint, anchor: 'middle' }).svg
    )
  }

  y += 38
  parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${t.grid}"/>`)

  // Star curve. The series is cumulative and monotonic, so a plain polyline is
  // the honest shape — smoothing here would invent stars that never happened.
  const pts = stars.points
  const x0 = PAD
  const x1 = W - PAD
  const yTop = y + 22
  const yBot = y + 98
  const tMin = pts[0][0]
  const tMax = pts.at(-1)[0]
  const vMax = pts.at(-1)[1] || 1
  const px = ms => x0 + (x1 - x0) * ((ms - tMin) / (tMax - tMin || 1))
  const py = v => yBot - (yBot - yTop) * (v / vMax)

  const d = pts.map(([ms, v], i) =>
    `${i ? 'L' : 'M'}${px(ms).toFixed(1)} ${py(v).toFixed(1)}`).join('')
  const endX = px(tMax)
  const endY = py(vMax)

  const month = ms => new Date(ms).toLocaleDateString('en-US',
    { month: 'short', year: 'numeric', timeZone: 'UTC' })

  parts.push(
    run('stars over time', PAD, y + 18, { size: 11, fill: t.faint }).svg,
    `<path class="area" d="${d}L${x1.toFixed(1)} ${yBot}L${x0.toFixed(1)} ${yBot}Z" fill="url(#g)"/>`,
    `<path class="line" d="${d}" fill="none" stroke="${t.accent}" stroke-width="2"` +
    ' stroke-linejoin="round" stroke-linecap="round"/>',
    `<circle class="pulse" cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="${t.accent}"/>`,
    `<circle class="tip" cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="${t.accent}"/>`,
    run(month(tMin), x0, yBot + 19, { size: 11, fill: t.faint }).svg,
    run(`${month(tMax)} · ${vMax}★`, x1, yBot + 19, { size: 11, fill: t.faint, anchor: 'end' }).svg
  )

  const H = yBot + 19 + PAD

  return frame(W, H, t, `
  <style>
    text{font-family:${MONO}}
    @keyframes draw{to{stroke-dashoffset:0}}
    @keyframes fade{to{opacity:1}}
    @keyframes ping{0%{r:4;opacity:.5}70%,100%{r:14;opacity:0}}
    .line{stroke-dasharray:2600;stroke-dashoffset:2600;
          animation:draw 2.2s cubic-bezier(.2,.7,.3,1) .3s forwards}
    .area{opacity:0;animation:fade 1.2s ease-out 1.4s forwards}
    .tip{opacity:0;animation:fade .4s ease-out 2.3s forwards}
    .pulse{animation:ping 2.4s ease-out 2.5s infinite}
  </style>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.accent}" stop-opacity="0.26"/>
      <stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"
        fill="${t.body}" stroke="${t.border}"/>
  ${parts.join('\n  ')}`)
}

/* ── README: generated so links can never drift from the panels ─────── */

function readme (data) {
  const { featured, upstream } = data

  const pic = (name, alt) => [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg">`,
    `  <img alt="${alt}" src="assets/${name}-light.svg" width="840">`,
    '</picture>'
  ].join('\n')

  const heroAlt =
    `Terminal session: 49 — backend and AI agent tooling, Go, TypeScript, ` +
    `self-hosted infra. One shipped project, ${featured.releases} releases in ` +
    `${featured.releaseSpanDays} days.`

  const cardAlt =
    `${featured.name}: ${featured.stars} stars, ${featured.forks} forks, ` +
    `${featured.releases} releases, ${featured.mergedPrs} merged PRs, ` +
    `a release every ${featured.daysPerRelease} days, with its star growth curve.`

  const links = upstream
    .map(u => `[\`${u.slug}#${u.number}\`](${u.url})`)
    .join(' · ')

  return [
    '<!-- Generated by scripts/render.mjs. Edit that, not this file. -->',
    '',
    pic('hero', heroAlt),
    '',
    pic('card', cardAlt),
    '',
    `**[${featured.slug}](https://github.com/${featured.slug})** — ${featured.description}`,
    '',
    `Merged upstream: ${links}`,
    '',
    '<sub>Both panels are drawn from live GitHub data by',
    '<a href="scripts/render.mjs">scripts/render.mjs</a> — hand-written SVG, no',
    'third-party badge service to go down. Refreshed every 6 hours.</sub>',
    ''
  ].join('\n')
}

const frame = (w, h, t, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
  `viewBox="0 0 ${w} ${h}" role="img">${inner}\n</svg>\n`

const data = JSON.parse(await readFile(new URL('../data/profile.json', import.meta.url)))

for (const [name, theme] of Object.entries(THEMES)) {
  for (const [file, make] of Object.entries({ hero, card })) {
    await writeFile(new URL(`../assets/${file}-${name}.svg`, import.meta.url), make(data, theme))
  }
}
await writeFile(new URL('../README.md', import.meta.url), readme(data))
console.log(`rendered ${Object.keys(THEMES).length * 2} svgs + README.md`)
