/**
 * reddit-scraper-mcp
 * AI-native Reddit API for autonomous workflows.
 * Programmatic access to subreddit info, posts, comments, and search.
 */

import http from 'http';
import Apify, { Actor } from 'apify';

// ts-standby: Always init unconditionally, detect standby after
await Actor.init();

const isStandby = process.env.APIFY_META_ORIGIN === 'STANDBY';
const PORT = Actor.config.get('containerPort') || process.env.ACTOR_WEB_SERVER_PORT || 3000;
const MCP_PATH = '/mcp';

// MCP Tool Manifest
const MCP_TOOLS = [
  {
    name: 'get_subreddit_info',
    description: 'Get information about a subreddit — name, title, description, subscriber count, active users, creation date, and whether it allows NSFW content.',
    inputSchema: {
      type: 'object',
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name (without r/, e.g. "technology", "stocks")' }
      },
      required: ['subreddit']
    }
  },
  {
    name: 'get_posts',
    description: 'Get posts from a subreddit with sorting options. Returns title, URL, author, score, comment count, selftext, permalink, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        subreddit: { type: 'string', description: 'Subreddit name (without r/)' },
        sort: { type: 'string', description: 'Sort order: hot, new, top, rising', default: 'hot' },
        limit: { type: 'integer', description: 'Number of posts to return (1-100)', default: 25 }
      },
      required: ['subreddit']
    }
  },
  {
    name: 'get_comments',
    description: 'Get comments from a Reddit post. Returns comment id, author, body, score, created time, parent id, permalink, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        post_permalink: { type: 'string', description: 'Reddit post permalink (e.g. /r/technology/comments/abc123/title/) or full URL' },
        limit: { type: 'integer', description: 'Number of comments to return (1-100)', default: 25 }
      },
      required: ['post_permalink']
    }
  },
  {
    name: 'search_reddit',
    description: 'Search Reddit for posts matching a query. Returns title, URL, author, score, comment count, selftext, permalink, and relevance summary.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        subreddit: { type: 'string', description: 'Limit search to specific subreddit (optional)' },
        sort: { type: 'string', description: 'Sort by: relevance, hot, new, top', default: 'relevance' },
        time: { type: 'string', description: 'Time filter: hour, day, week, month, year, all', default: 'month' },
        limit: { type: 'integer', description: 'Number of results (1-100)', default: 25 }
      },
      required: ['query']
    }
  }
];

// HTTP Server for MCP Protocol (used in standby mode)
if (isStandby) {
  const server = http.createServer(async (req, res) => {
    // Handle readiness probe
    if (req.headers['x-apify-container-server-readiness-probe']) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    // Handle MCP requests
    if (req.method === 'POST' && req.url === '/mcp') {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);
      if (contentLength > 1_000_000) { // 1MB limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const jsonBody = JSON.parse(body);
          const id = jsonBody.id ?? null;

          const reply = (result) => {
            const resp = id !== null
              ? { jsonrpc: '2.0', id, result }
              : result;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp));
          };

          const replyError = (code, message) => {
            const resp = id !== null
              ? { jsonrpc: '2.0', id, error: { code, message } }
              : { status: 'error', error: message };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(resp));
          };

          const method = jsonBody.method;

          // Standard MCP: initialize
          if (method === 'initialize') {
            return reply({
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'reddit-scraper-mcp', version: '1.0.0' }
            });
          }

          // Standard MCP: tools/list
          if (method === 'tools/list' || (!method && jsonBody.tool === 'list')) {
            return reply({ tools: MCP_TOOLS });
          }

          // Standard MCP: tools/call
          if (method === 'tools/call') {
            const toolName = jsonBody.params?.name;
            const toolArgs = jsonBody.params?.arguments || {};
            if (!toolName) return replyError(-32602, 'Missing params.name');
            // Wrap tool execution in 90s timeout to prevent standby from hanging
            const toolResult = await Promise.race([
              handleToolCall(toolName, toolArgs),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            return reply({
              content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
            });
          }

          // Legacy: tools/{toolName} method format
          if (method && method.startsWith('tools/')) {
            const toolName = method.slice(6);
            const toolArgs = jsonBody.params || {};
            const toolResult = await Promise.race([
              handleToolCall(toolName, toolArgs),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            return reply({
              content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
            });
          }

          // Legacy direct: {tool: "...", params: {...}}
          if (jsonBody.tool) {
            const toolResult = await Promise.race([
              handleToolCall(jsonBody.tool, jsonBody.params || {}),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timeout (90s)')), 90000))
            ]).catch(err => ({ error: err.message }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', result: toolResult }));
            return;
          }

          replyError(-32601, `Method not found: ${method}`);
        } catch (error) {
          console.error('MCP error:', error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: error.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, () => {
    Actor.log.info(`Reddit Scraper MCP listening on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close(() => Actor.exit());
  });
} else {
  // Batch mode: run tool and exit
  const input = await Actor.getInput();
  if (input) {
    const { tool, params = {} } = input;
    if (tool) {
      Actor.log.info(`Running tool: ${tool}`);
      const result = await handleToolCall(tool, params);
      await Actor.setValue('OUTPUT', result);
    }
  }
  await Actor.exit();
}

// Export handleRequest for MCP gateway compatibility
export default {
  handleRequest: async ({ request, log }) => {
    log.info("Reddit Scraper MCP received request");
    try {
      const { method, params } = request;
      if (method === 'tools/list') {
        return { tools: MCP_TOOLS };
      }
      if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const result = await handleToolCall(name, args || {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      return { error: 'Unknown method' };
    } catch (error) {
      log.error(error.message);
      return { error: error.message };
    }
  }
};

// Data Fetchers with 120s timeout
const TIMEOUT = 120000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// Reddit base URL (old.reddit.com is more stable)
const REDDIT_BASE = 'https://old.reddit.com';
const USER_AGENT = 'Mozilla/5.0 (compatible; Apify/1.0; +https://apify.com)';

// ---- Subreddit Info ----
async function fetchSubredditInfo(subreddit) {
  try {
    const url = `${REDDIT_BASE}/r/${encodeURIComponent(subreddit)}/about.json`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) {
      if (response.status === 404) return { error: `Subreddit r/${subreddit} not found` };
      throw new Error(`Reddit API error: ${response.status}`);
    }
    const data = await response.json();
    const sub = data.data;

    return {
      display_name: sub.display_name,
      title: sub.title,
      description: sub.description || '',
      description_html: sub.description_html || '',
      subscribers: sub.subscribers,
      active_users: sub.accounts_active || 0,
      created_utc: sub.created_utc,
      over18: sub.over18,
      public_description: sub.public_description || '',
      url: sub.url,
      subreddit_type: sub.subreddit_type,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Subreddit info fetch failed:', error.message);
    return { error: error.message };
  }
}

// ---- Posts ----
async function fetchPosts(subreddit, sort = 'hot', limit = 25) {
  try {
    const sortPath = sort === 'hot' ? '' : `/${sort}`;
    const url = `${REDDIT_BASE}/r/${encodeURIComponent(subreddit)}${sortPath}.json?limit=${Math.min(limit, 100)}`;

    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) {
      if (response.status === 404) return { error: `Subreddit r/${subreddit} not found` };
      throw new Error(`Reddit API error: ${response.status}`);
    }
    const data = await response.json();

    const posts = (data.data?.children || []).map(item => {
      const p = item.data;
      return {
        title: p.title,
        url: p.url,
        author: p.author,
        created_utc: p.created_utc,
        score: p.score,
        num_comments: p.num_comments,
        selftext: p.selftext || '',
        permalink: p.permalink,
        subreddit: p.subreddit,
        domain: p.domain,
        is_self: p.is_self,
        is_video: p.is_video,
        link_flair_text: p.link_flair_text || null,
        timestamp: new Date().toISOString()
      };
    });

    return {
      subreddit,
      sort,
      limit,
      posts,
      count: posts.length
    };
  } catch (error) {
    console.error('Posts fetch failed:', error.message);
    return { subreddit, sort, limit, posts: [], error: error.message };
  }
}

// ---- Comments ----
async function fetchComments(post_permalink, limit = 25) {
  try {
    // Normalize permalink to JSON API format
    let normalized = post_permalink;
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (!normalized.endsWith('.json')) normalized = normalized + '.json';

    const url = `${REDDIT_BASE}${normalized}?limit=${Math.min(limit, 100)}`;

    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }
    const data = await response.json();

    // Reddit returns [post_data, comments_data]
    const postData = data[0]?.data?.children?.[0]?.data;
    const commentsData = data[1]?.data?.children || [];

    const comments = commentsData.map(item => {
      const c = item.data;
      return {
        id: c.id,
        author: c.author,
        body: c.body,
        created_utc: c.created_utc,
        score: c.score,
        parent_id: c.parent_id,
        permalink: c.permalink,
        subreddit: c.subreddit,
        is_submitter: c.is_submitter || false,
        distinguished: c.distinguished || null,
        link_id: c.link_id || null,
        depth: c.depth || 0,
        timestamp: new Date().toISOString()
      };
    });

    return {
      post_title: postData?.title || '',
      post_url: postData?.url || '',
      comments,
      count: comments.length
    };
  } catch (error) {
    console.error('Comments fetch failed:', error.message);
    return { comments: [], error: error.message };
  }
}

// ---- Search ----
async function fetchSearch(query, subreddit, sort = 'relevance', time = 'month', limit = 25) {
  try {
    let url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}&limit=${Math.min(limit, 100)}`;
    if (subreddit) {
      url += `&restrict_sr=on&sr=${encodeURIComponent(subreddit)}`;
    }

    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) throw new Error(`Reddit API error: ${response.status}`);

    const data = await response.json();

    const results = (data.data?.children || []).map(item => {
      const p = item.data;
      // Calculate relevance summary from title/match
      const queryLower = query.toLowerCase();
      const titleLower = p.title.toLowerCase();
      const matchCount = (titleLower.match(new RegExp(queryLower.split(' ').join('|'), 'gi')) || []).length;
      const match_summary = matchCount > 0 ? `Title matches: ${matchCount}` : 'No title match';

      return {
        title: p.title,
        url: p.url,
        author: p.author,
        created_utc: p.created_utc,
        score: p.score,
        num_comments: p.num_comments,
        selftext: p.selftext || '',
        permalink: p.permalink,
        subreddit: p.subreddit,
        match_summary,
        timestamp: new Date().toISOString()
      };
    });

    return {
      query,
      subreddit: subreddit || 'all',
      sort,
      time,
      results,
      count: results.length
    };
  } catch (error) {
    console.error('Search failed:', error.message);
    return { query, results: [], error: error.message };
  }
}

// ---- Main Tool Handler ----
async function handleToolCall(tool, args) {
  // PPE pricing map (in cents)
  const PPE_PRICES = {
    'get_subreddit_info': 3,  // $0.03
    'get_posts': 3,           // $0.03
    'get_comments': 5,        // $0.05
    'search_reddit': 5        // $0.05
  };

  const price = PPE_PRICES[tool];
  if (price) {
    await Actor.charge(price, { eventName: tool });
  }

  switch (tool) {
    case 'get_subreddit_info':
      return await fetchSubredditInfo(args.subreddit);

    case 'get_posts':
      return await fetchPosts(args.subreddit, args.sort, args.limit);

    case 'get_comments':
      return await fetchComments(args.post_permalink, args.limit);

    case 'search_reddit':
      return await fetchSearch(args.query, args.subreddit, args.sort, args.time, args.limit);

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}