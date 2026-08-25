#!/usr/bin/env node
// Pulls the numbers the profile is built on into data/profile.json.
// No dependencies: Node's native fetch only.

import { readFile, writeFile, mkdir } from 'node:fs/promises'

const USER = 'y49'
const FEATURED = 'y49/tlive'

// Actions' built-in GITHUB_TOKEN is scoped to this repository, and listing
// another repo's stargazers is outside that scope (403). PROFILE_TOKEN, a PAT
// with public read, lifts that; without it the star curve simply keeps the
// series already committed rather than failing the run.
const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('PROFILE_TOKEN or GITHUB_TOKEN is required')
  process.exit(1)
}

async function api (path, { accept = 'application/vnd.github+json' } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept,
      authorization: `Bearer ${token}`,
      'user-agent': `${USER}-profile`,
      'x-github-api-version': '2022-11-28'
    }
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`)
  return { body: await res.json(), link: res.headers.get('link') ?? '' }
}

// Walks every page of a list endpoint. GitHub caps this at 100 per page.
async function all (path, opts) {
  const out = []
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const { body, link } = await api(`${path}${sep}per_page=100&page=${page}`, opts)
    out.push(...(Array.isArray(body) ? body : body.items ?? []))
    if (!link.includes('rel="next"')) return out
  }
}

// Falls back to whatever series is already on disk, so a token without the
// scope for stargazers degrades the chart's freshness instead of the build.
async function previousStars () {
  try {
    const raw = await readFile(new URL('../data/profile.json', import.meta.url))
    const prev = JSON.parse(raw).stars
    if (prev?.points?.length) return prev
  } catch {}
  throw new Error('no star series available and none cached in data/profile.json')
}

const days = (from, to) => Math.max(1, Math.round((to - from) / 86400000))

// Star timestamps collapse into a cumulative series the chart can draw
// straight from: one point per star, plus a zero point at repo creation.
function starSeries (stamps, createdAt) {
  const sorted = stamps.map(s => Date.parse(s)).sort((a, b) => a - b)
  return {
    from: createdAt,
    points: [[Date.parse(createdAt), 0], ...sorted.map((t, i) => [t, i + 1])]
  }
}

const repo = (await api(`/repos/${FEATURED}`)).body
const user = (await api(`/users/${USER}`)).body

const releases = await all(`/repos/${FEATURED}/releases`)
const merged = await all(`/search/issues?q=repo:${FEATURED}+author:${USER}+type:pr+is:merged`)

let stargazers = null
try {
  stargazers = await all(`/repos/${FEATURED}/stargazers`, {
    accept: 'application/vnd.github.star+json'
  })
} catch (err) {
  console.warn(`stargazers unavailable (${err.message}); keeping the last series`)
}

// Merged PRs into repos someone else owns, ranked by how big that project is.
const upstreamHits = (await api(
  `/search/issues?q=author:${USER}+type:pr+is:merged+-user:${USER}&per_page=50`
)).body.items ?? []

const upstream = []
for (const pr of upstreamHits) {
  const slug = pr.repository_url.replace('https://api.github.com/repos/', '')
  const { body: r } = await api(`/repos/${slug}`)
  upstream.push({
    slug,
    stars: r.stargazers_count,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    mergedAt: pr.closed_at
  })
}
upstream.sort((a, b) => b.stars - a.stars)

const published = releases
  .map(r => r.published_at)
  .filter(Boolean)
  .sort()

const releaseSpan = published.length > 1
  ? days(Date.parse(published[0]), Date.parse(published.at(-1)))
  : 0

const profile = {
  user: {
    login: user.login,
    since: user.created_at,
    years: Math.floor(days(Date.parse(user.created_at), Date.now()) / 365)
  },
  featured: {
    slug: repo.full_name,
    name: repo.name,
    description: repo.description,
    language: Object.keys((await api(`/repos/${FEATURED}/languages`)).body)[0],
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    releases: releases.length,
    mergedPrs: merged.length,
    topics: repo.topics,
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    // The headline number: sustained shipping cadence, not a one-off burst.
    daysPerRelease: releases.length > 1
      ? +(releaseSpan / (releases.length - 1)).toFixed(1)
      : null,
    releaseSpanDays: releaseSpan
  },
  stars: stargazers
    ? starSeries(stargazers.map(s => s.starred_at), repo.created_at)
    : await previousStars(),
  upstream
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true })
await writeFile(
  new URL('../data/profile.json', import.meta.url),
  JSON.stringify(profile, null, 2) + '\n'
)

console.log(
  `${profile.featured.slug}: ${profile.featured.stars}★  ` +
  `${profile.featured.releases} releases  ` +
  `${profile.featured.daysPerRelease}d/release  ` +
  `${profile.stars.points.length - 1} star points  ` +
  `${upstream.length} upstream`
)
