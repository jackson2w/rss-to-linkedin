# rss-to-linkedin

## Project
Cloudflare Worker that cross-posts new blog articles from williejackson.com/writing/feed/ to LinkedIn.

## Key identifiers
- LinkedIn person URN: `urn:li:person:p0mkw138Rs` (personal profile, active)
- LinkedIn org URN: `urn:li:organization:107821626` (company page — needs Marketing Developer Platform approval before use)
- KV namespace: `25d862ed73644266943c2d2cff856498` (binding: `RSS_STATE`, key: `last_posted_guid`)
- Worker URL: `https://rss-to-linkedin.willie-jackson.workers.dev`
- Cron: `0 14 * * *` (9am ET)

## Deploy workflow
`npm run deploy` — auto-commits, pushes to GitHub, then deploys to Cloudflare.
When deploying to GitHub: always update README.md and run `gh repo edit` to sync the about/description.

## Testing
- Manual trigger: `curl https://rss-to-linkedin.willie-jackson.workers.dev/trigger`
- Live logs: `npm run tail`
- Reset deduplication state: `npx wrangler kv key delete --binding RSS_STATE last_posted_guid`

## LinkedIn API
- Posting to personal profile requires `w_member_social` scope ("Share on LinkedIn" product — self-serve)
- Posting to org page requires `w_organization_social` ("Marketing Developer Platform" — requires LinkedIn approval, not self-serve)
- Token expires every 60 days — regenerate at linkedin.com/developers/tools/oauth/token-generator with `openid` + `profile` + `w_member_social` checked
- Person ID found via: `curl -H 'Authorization: Bearer TOKEN' https://api.linkedin.com/v2/userinfo` → `sub` field
- Use `/v2/userinfo` not `/v2/me` — the latter requires additional scopes
- Set token: `echo -n "TOKEN" | npx wrangler secret put LINKEDIN_ACCESS_TOKEN` (single quotes prevent shell interpolation)

## WordPress RSS quirks
- Strip inline tags with empty string (not space) — avoids drop-cap gap (`<span>C</span>larity` → `Clarity`) and space-before-punctuation (`word .` → `word.`)
- Strip `<a class="button ...">` links before body text and URL extraction
- Block elements → `\n\n`, inline elements → `""`, then clean up ` .` → `.`
