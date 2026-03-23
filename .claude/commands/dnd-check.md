Check the daily-news-digest pipeline status for today. Run all checks in parallel where possible.

## Checks to perform

1. **Drafts**: Check if today's draft JSON files exist in `config/drafts/` on GitHub (via API: `https://api.github.com/repos/Amb2rZhou/daily-news-digest/contents/config/drafts`)
   - Look for `{today}_ch_*.json` files
   - Report how many channels have drafts

2. **Exports**: Check if today's MD and HTML files exist in `config/exports/` on GitHub
   - Look for `{today}_focused.md`, `{today}_broad.md`, `{today}_focused.html`, `{today}_broad.html`
   - Report which are present / missing

3. **GitHub Pages**: Fetch these two URLs and report if they return 200 or 404:
   - `https://amb2rzhou.github.io/daily-news-digest/news/{today}_focused.html`
   - `https://amb2rzhou.github.io/daily-news-digest/news/{today}_broad.html`

4. **Workflow runs**: Check the latest fetch-news.yml and deploy-admin.yml runs via GitHub API
   - `https://api.github.com/repos/Amb2rZhou/daily-news-digest/actions/workflows/fetch-news.yml/runs?per_page=3`
   - `https://api.github.com/repos/Amb2rZhou/daily-news-digest/actions/workflows/deploy-admin.yml/runs?per_page=3`
   - Report status, conclusion, and time for each

## Output format

Use a concise status table:

```
Pipeline Status — {today}
----------------------------
Drafts:      {count} channels OK / missing: {list}
MD exports:  focused [{status}]  broad [{status}]
HTML exports: focused [{status}]  broad [{status}]
Pages live:  focused [{status}]  broad [{status}]
fetch-news:  last run {time} — {conclusion}
deploy-admin: last run {time} — {conclusion}
```

If anything is missing or failed, add a brief diagnosis at the end.
