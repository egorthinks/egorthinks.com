// GET /api/bonsai?u=<login>
//
// Feeds the playground at /bonsai/. Reads a GitHub account's public history
// through the GraphQL API with a server-side token and hands the browser the
// raw shape git-bonsai's own normalize() expects, so the tree the page grows is
// the tree the Action would grow: the real contribution calendar and the real
// per-language byte sizes, not the approximation the anonymous REST path gives.
//
// Why a function at all: anonymous api.github.com allows 60 requests an hour per
// IP, which one impatient visitor burns through. A token lifts that to 5000/h.
// The token is read from the environment and never leaves this file.
//
// Environment: GITHUB_TOKEN (or BONSAI_GITHUB_TOKEN). A classic PAT with NO
// scopes, or a fine-grained token with public read, is enough - this endpoint
// only ever reads public data. Without one it answers 503 and the page falls
// back to its tokenless path.
//
// Deployed as a Vercel Function (zero-config /api directory). Responses are
// edge-cached for six hours, so a name that gets passed around costs the token
// one read per six hours rather than one per visitor.

const GQL_URL = 'https://api.github.com/graphql';
const DAY_MS = 86_400_000;
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

const CALENDAR_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const REPOS_QUERY = `
query($login: String!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false,
                 orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes {
        createdAt
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

const ORG_QUERY = `
query($login: String!) {
  organization(login: $login) {
    createdAt
    repositories(first: 100, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes {
        createdAt
        languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100) { totalCount nodes { committedDate } }
            }
          }
        }
      }
    }
  }
}`;

class UpstreamError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

async function gql(token, query, variables) {
    const res = await fetch(GQL_URL, {
        method: 'POST',
        headers: {
            Authorization: `bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'egorthinks.com/bonsai (+https://github.com/egorthinks/git-bonsai)'
        },
        body: JSON.stringify({ query, variables })
    });
    if (res.status === 401 || res.status === 403) {
        throw new UpstreamError('the server token was rejected by GitHub', 502);
    }
    if (!res.ok) throw new UpstreamError(`GitHub GraphQL answered HTTP ${res.status}`, 502);
    const body = await res.json();
    // A probe for a login that is an org NOT_FOUNDs the user field, so a partial
    // response is normal here. Only a missing data block is fatal.
    if (!body.data) throw new UpstreamError(`GitHub GraphQL: ${body.errors?.[0]?.message ?? 'empty response'}`, 502);
    return body.data;
}

/** Day windows covering createdAt..now, since one query returns at most a year. */
function windows(createdAt, now) {
    const out = [];
    let from = new Date(createdAt);
    while (from < now) {
        const to = new Date(Math.min(from.getTime() + 364 * DAY_MS, now.getTime()));
        out.push({ from: from.toISOString(), to: to.toISOString() });
        from = new Date(to.getTime() + DAY_MS);
    }
    return out;
}

/**
 * Contiguous daily counts, wired for the wire: the calendar always comes back as
 * whole weeks, so a start date plus one integer per day says the same thing as
 * six thousand {date, count} objects at a sixth of the bytes. Any hole left by a
 * missing week is filled with zeroes rather than silently shifting the series.
 */
function packDays(perDay, now) {
    const dates = [...perDay.keys()].sort();
    if (dates.length === 0) return null;
    const first = Date.parse(dates[0] + 'T00:00:00Z');
    // Never run past today. A calendar that answered in whole weeks would
    // otherwise end in a tail of empty future days, and an empty tail reads as
    // a broken streak to everything downstream.
    const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
    const last = Math.min(Date.parse(dates[dates.length - 1] + 'T00:00:00Z'), today);
    if (last < first) return null;
    const counts = [];
    for (let t = first; t <= last; t += DAY_MS) {
        counts.push(perDay.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
    }
    return { from: dates[0], counts };
}

async function fetchUser(login, token, now) {
    const probe = await gql(token, CALENDAR_QUERY, {
        login,
        from: new Date(now.getTime() - 300 * DAY_MS).toISOString(),
        to: now.toISOString()
    });
    if (!probe.user) return null;
    const createdAt = probe.user.createdAt;

    // The year walk runs in parallel: a seventeen-year account is seventeen
    // round trips, and doing those in sequence is most of a function timeout.
    const [calendars, repos] = await Promise.all([
        Promise.all(windows(createdAt, now).map((w) => gql(token, CALENDAR_QUERY, { login, ...w }))),
        gql(token, REPOS_QUERY, { login })
    ]);

    const perDay = new Map();
    for (const data of calendars) {
        for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
            for (const d of week.contributionDays) perDay.set(d.date, d.contributionCount);
        }
    }

    return {
        username: login,
        createdAt,
        isOrg: false,
        days: packDays(perDay, now),
        repos: repos.user.repositories.nodes
    };
}

/**
 * Organizations have no contribution calendar, so the daily series is folded out
 * of recent default-branch commits across the top repositories - the same
 * approximation the Action makes. history(first: 100) undercounts, so the branch
 * totals ride along as a floor the page applies after normalizing.
 */
async function fetchOrg(login, token, now) {
    const data = await gql(token, ORG_QUERY, { login });
    if (!data.organization) return null;
    const { createdAt, repositories } = data.organization;

    const perCommitDay = new Map();
    let totalCommits = 0;
    for (const repo of repositories.nodes) {
        const hist = repo.defaultBranchRef?.target?.history;
        if (!hist) continue;
        totalCommits += hist.totalCount;
        for (const c of hist.nodes) {
            const day = c.committedDate.slice(0, 10);
            perCommitDay.set(day, (perCommitDay.get(day) ?? 0) + 1);
        }
    }

    const perDay = new Map();
    for (let t = Date.parse(createdAt); t <= now.getTime(); t += DAY_MS) {
        const date = new Date(t).toISOString().slice(0, 10);
        perDay.set(date, perCommitDay.get(date) ?? 0);
    }

    return {
        username: login,
        createdAt,
        isOrg: true,
        days: packDays(perDay, now),
        repos: repositories.nodes,
        totalContributionsFloor: totalCommits
    };
}

export default async function handler(req, res) {
    const login = String(req.query?.u ?? '');
    if (!LOGIN_RE.test(login)) {
        return res.status(400).json({ error: 'invalid GitHub login' });
    }

    const token = process.env.GITHUB_TOKEN || process.env.BONSAI_GITHUB_TOKEN;
    if (!token) {
        // Not an error the visitor should see: the page has a tokenless path and
        // takes a 503 as its cue to walk it.
        return res.status(503).json({ error: 'server token not configured' });
    }

    const now = new Date();
    try {
        const payload = (await fetchUser(login, token, now)) ?? (await fetchOrg(login, token, now));
        if (!payload) return res.status(404).json({ error: `no GitHub account named "${login}"` });
        if (!payload.days) return res.status(502).json({ error: 'the contribution calendar came back empty' });

        res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
        return res.status(200).json(payload);
    } catch (err) {
        const status = err instanceof UpstreamError ? err.status : 502;
        return res.status(status).json({ error: err?.message ?? String(err) });
    }
}

