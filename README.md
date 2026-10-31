# Reddit Scraper MCP

**Run it on the Apify Store:** https://apify.com/red.cars/reddit-scraper-mcp
> [ScraperFleet data page](https://scraperfleet.com/actors/reddit-scraper-mcp/)
AI-native Reddit API for autonomous workflows. Programmatic access to subreddit info, posts, comments, and search.

## Tools

| Tool | Description | Price |
|------|-------------|-------|
| `get_subreddit_info` | Get subreddit metadata — name, title, description, subscribers, active users, creation date, NSFW flag | $0.03 |
| `get_posts` | Get posts from any subreddit with sorting (hot/new/top/rising) | $0.03 |
| `get_comments` | Get comments from a Reddit post | $0.05 |
| `search_reddit` | Search Reddit for posts matching a query with time and sort filters | $0.05 |

## Use Cases

- **Sentiment analysis** — monitor community reactions to products, brands, events
- **Market research** — discover trending topics, user discussions, pain points
- **Competitive intelligence** — track discussions about competitors
- **Content inspiration** — find viral posts, trending discussions in any niche
- **Academic research** — gather Reddit data for social science research

## API

### MCP Protocol (Standby Mode)

Start with `initialize`:
```json
{ "method": "initialize", "params": {} }
```

List tools:
```json
{ "method": "tools/list" }
```

Call a tool:
```json
{ "method": "tools/call", "params": { "name": "get_subreddit_info", "arguments": { "subreddit": "technology" } } }
```

### Legacy Format

```json
{ "tool": "get_subreddit_info", "params": { "subreddit": "technology" } }
```

## Installation

```bash
npm install
```

## Testing

```bash
echo '{"tool": "get_subreddit_info", "params": {"subreddit": "technology"}}' | INPUT_STORE=1 apify run
```

## Build

```bash
npm install
node --check src/main.js
apify push
```

## License

MIT