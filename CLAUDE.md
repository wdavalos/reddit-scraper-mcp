# reddit-scraper-mcp

## What this does
MCP server that provides AI agents programmatic access to Reddit data: subreddit info, posts, comments, and search. Built for sentiment analysis, community intelligence, and market research workflows.

## Key files
- `src/main.js` — MCP server implementation (4 tools)
- `.actor/actor.json` — Actor definition, usesStandbyMode: true, pricing: PAY_PER_EVENT
- `Dockerfile` — ts-standby template

## Patterns
- ts-standby MCP actor (HTTP standby mode)
- PPE charging: `Actor.charge(price, { eventName: canonicalName })`
- containerPort (not standbyPort)
- `await Actor.init()` unconditional init
- Readiness probe: `x-apify-container-server-readiness-probe` header
- 90s timeout wrapper per tool via Promise.race
- Reddit JSON API via old.reddit.com (more stable than new Reddit)

## Tools (PPE pricing)
1. `get_subreddit_info` — $0.03 PPE
2. `get_posts` — $0.03 PPE
3. `get_comments` — $0.05 PPE
4. `search_reddit` — $0.05 PPE

## Build
```bash
npm install
node --check src/main.js
apify push
```

## Testing
```bash
echo '{"tool": "get_subreddit_info", "params": {"subreddit": "technology"}}' | INPUT_STORE=1 apify run
```