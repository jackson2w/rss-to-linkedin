# rss-to-linkedin

A Cloudflare Worker that watches a blog's RSS feed and automatically cross-posts new articles to LinkedIn.

## How it works

- Runs daily on a cron schedule (default: 9am ET)
- Fetches the latest item from the configured RSS feed
- Compares it against the last-posted article stored in Cloudflare KV
- If it's new, formats and posts it to LinkedIn via the UGC Posts API
- Updates KV so the same article isn't posted twice

Posts are formatted as:

```
ARTICLE TITLE IN ALL CAPS

Full article text with paragraph breaks preserved.

Links from this post:
› https://example.com

Originally published here: https://yourblog.com/article
```

## Stack

- [Cloudflare Workers](https://workers.cloudflare.com/) — serverless runtime and cron
- [Cloudflare KV](https://developers.cloudflare.com/kv/) — deduplication state
- [LinkedIn UGC Posts API](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) — posting

## Setup

### 1. Prerequisites

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install`)
- A [LinkedIn Developer App](https://www.linkedin.com/developers/) with **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** products added
- A LinkedIn OAuth access token with `w_member_social`, `openid`, and `profile` scopes

### 2. Configure

Edit `wrangler.toml`:

```toml
# Personal profile (requires w_member_social)
LINKEDIN_AUTHOR_URN = "urn:li:person:YOUR_PERSON_ID"

# Or company page (requires w_organization_social via Marketing Developer Platform)
# LINKEDIN_AUTHOR_URN = "urn:li:organization:YOUR_ORG_ID"
```

Adjust the cron schedule if needed (`0 14 * * *` = 9am ET):

```toml
[triggers]
crons = ["0 14 * * *"]
```

### 3. Set your LinkedIn access token

```bash
echo -n "YOUR_ACCESS_TOKEN" | npx wrangler secret put LINKEDIN_ACCESS_TOKEN
```

To find your Person ID, run:

```bash
curl -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
     -H 'X-Restli-Protocol-Version: 2.0.0' \
     https://api.linkedin.com/v2/userinfo
```

Use the `sub` field from the response.

### 4. Deploy

```bash
npm run deploy
```

This commits and pushes to GitHub, then deploys to Cloudflare.

### 5. Test manually

```bash
curl https://rss-to-linkedin.<your-subdomain>.workers.dev/trigger
npx wrangler tail
```

## Token expiry

LinkedIn access tokens expire after **60 days**. To refresh:

1. Go to [linkedin.com/developers/tools/oauth/token-generator](https://www.linkedin.com/developers/tools/oauth/token-generator)
2. Select your app, check `w_member_social` + `openid` + `profile`
3. Generate and set the new token:
   ```bash
   echo -n "NEW_TOKEN" | npx wrangler secret put LINKEDIN_ACCESS_TOKEN
   ```
