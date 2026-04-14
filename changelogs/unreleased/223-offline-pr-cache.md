---
type: enhancement
pr: 223
---

Stale-while-revalidate PR cache: last-known PR data is stored in localStorage (cpc_pr_cache) and rendered immediately on app open, eliminating the 2-5s loading spinner on slow connections. Cache expires after 1 hour; footer shows "cached Xm ago" until live data arrives.
