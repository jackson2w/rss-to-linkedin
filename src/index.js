const RSS_URL = 'https://williejackson.com/writing/feed/';
const LINKEDIN_API_URL = 'https://api.linkedin.com/v2/ugcPosts';
const KV_KEY = 'last_posted_guid';
const LINKEDIN_CHAR_LIMIT = 3000;

export default {
  // Runs on cron schedule (see wrangler.toml)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger for testing: curl https://<worker-url>/trigger
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger') {
      ctx.waitUntil(run(env));
      return new Response('Triggered. Check worker logs for result.', { status: 200 });
    }
    return new Response('RSS to LinkedIn worker is running.', { status: 200 });
  },
};

async function run(env) {
  const rssText = await fetchRSS();
  const item = parseLatestItem(rssText);

  if (!item) {
    console.log('No items found in RSS feed.');
    return;
  }

  const lastPostedGuid = await env.RSS_STATE.get(KV_KEY);
  if (lastPostedGuid === item.guid) {
    console.log(`Already posted: "${item.title}" (${item.guid})`);
    return;
  }

  console.log(`New item found: "${item.title}"`);
  const postText = formatPost(item);
  console.log(`Post length: ${postText.length} chars`);

  await postToLinkedIn(postText, env.LINKEDIN_ACCESS_TOKEN, env.LINKEDIN_AUTHOR_URN);
  await env.RSS_STATE.put(KV_KEY, item.guid);
  console.log(`Successfully posted: "${item.title}"`);
}

// --- RSS Fetching & Parsing ---

async function fetchRSS() {
  const response = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'rss-to-linkedin-worker/1.0' },
  });
  if (!response.ok) {
    throw new Error(`RSS fetch failed with status ${response.status}`);
  }
  return response.text();
}

function parseLatestItem(xml) {
  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!itemMatch) return null;
  const itemXml = itemMatch[1];

  const title = extractCDATA(itemXml, 'title') ?? extractTag(itemXml, 'title');
  const link = extractTag(itemXml, 'link');
  // guid may be a URL or an arbitrary string
  const guid = extractTag(itemXml, 'guid') ?? link;
  // Prefer full content over excerpt
  const content =
    extractCDATA(itemXml, 'content:encoded') ??
    extractCDATA(itemXml, 'description') ??
    extractTag(itemXml, 'description') ??
    '';

  return { title, link, guid, content };
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
  return match ? match[1].trim() : null;
}

function extractCDATA(xml, tag) {
  const cdataMatch = xml.match(
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`)
  );
  if (cdataMatch) return cdataMatch[1].trim();
  return null;
}

// --- Post Formatting ---

function formatPost(item) {
  const links = extractLinks(item.content);
  const bodyText = stripHtml(item.content);

  const header = `${item.title.toUpperCase()}\n\n`;

  const linksSection =
    links.length > 0
      ? '\n\nLinks from this post:\n' + links.map((l) => `› ${l}`).join('\n')
      : '';

  const boilerplate = `\n\nOriginally published here: ${item.link}`;

  const footer = linksSection + boilerplate;

  // Truncate body if needed to stay within LinkedIn's 3000-char limit.
  // Cut at the last paragraph break before the limit so it doesn't end mid-sentence.
  const truncationNote = '\n\n(Continued at link below)';
  const maxBodyLen = LINKEDIN_CHAR_LIMIT - header.length - footer.length - truncationNote.length;
  let body = bodyText;
  if (bodyText.length > maxBodyLen) {
    const cut = bodyText.lastIndexOf('\n\n', maxBodyLen);
    body = (cut > 0 ? bodyText.slice(0, cut) : bodyText.slice(0, maxBodyLen)) + truncationNote;
  }

  return header + body + footer;
}

function stripHtml(html) {
  return html
    // Remove button/CTA links entirely (tag + inner text) — don't list these as links either
    .replace(/<a[^>]*class="[^"]*button[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
    // Block-level elements become paragraph breaks
    .replace(/<\/?(?:p|div|section|article|header|footer|h[1-6]|blockquote|pre|ul|ol)[^>]*>/gi, '\n\n')
    // Line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    // List items
    .replace(/<li[^>]*>/gi, '\n• ')
    // Strip all remaining inline tags with NO replacement (avoids "C larity" drop-cap gap and "word ." spacing)
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&nbsp;/g, ' ')
    // Remove space before punctuation (e.g. "word ." → "word.")
    .replace(/ ([.,;:!?])/g, '$1')
    // Collapse multiple spaces on the same line (leave newlines alone)
    .replace(/[^\S\n]{2,}/g, ' ')
    // Trim leading/trailing spaces on each line
    .replace(/^ +| +$/gm, '')
    // Collapse 3+ consecutive newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLinks(html) {
  // Strip button links before scanning so their URLs don't appear in the links section
  const stripped = html.replace(/<a[^>]*class="[^"]*button[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  const links = [];
  const linkRegex = /<a[^>]+href=["']([^"'#][^"']*?)["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(stripped)) !== null) {
    const url = match[1];
    if (!url.startsWith('mailto:')) {
      links.push(url);
    }
  }
  return [...new Set(links)];
}

// --- LinkedIn API ---

async function postToLinkedIn(text, accessToken, authorUrn) {
  if (!accessToken) {
    throw new Error('LINKEDIN_ACCESS_TOKEN secret is not set.');
  }
  if (!authorUrn || authorUrn.includes('REPLACE_WITH')) {
    throw new Error('LINKEDIN_AUTHOR_URN is not configured in wrangler.toml.');
  }

  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await fetch(LINKEDIN_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LinkedIn API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  console.log(`LinkedIn post created: ${result.id}`);
  return result;
}
