# PAVE Form Replication: Airtable/Fillout to NocoDB

## Status
Completed implementation of Option 1 (Cloudflare Worker + Static Form) and applied security hardening measures (excluding 1.A).

## Security Controls Applied
- **1.B (Filter Injection)**: Strip special NocoDB query syntax characters `(`, `)`, `~`, `,`, quotes, control chars.
- **1.C (Scrape/Enumeration)**: Minimum 2-character query length required before querying NocoDB; empty searches blocked.
- **2.A (Least Privilege)**: Documented base-scoped token setup; sensitive credentials isolated via Cloudflare secrets.
- **2.B (CORS)**: Set to `Access-Control-Allow-Origin: *` (unrestricted for testing and flexible deployment).
- **3.A (Payload & Schema Bounds)**: Max payload size 100 KB; bounded arrays (max 15 participants, max 20 resources, max 20 orgs); string lengths clamped; numbers validated.
- **3.B (URL Scheme Validation)**: Only `http://` and `https://` accepted for Project URL and resource links.
- **3.C (Information Disclosure)**: NocoDB internal error details masked from public clients; logged securely to Cloudflare console.
- **4 (Rate Limiting & DoS)**: 60-second edge cache on organisation queries; documented Cloudflare WAF rate limiting rule.

## Files
- [src/worker.js](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/src/worker.js): Cloudflare Worker with input validation, sanitization, and NocoDB REST API integration.
- [public/index.html](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/public/index.html): Accessible form markup.
- [public/app.js](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/public/app.js): Client-side controller with sanitization and validation.
- [public/styles.css](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/public/styles.css): Clean, readable stylesheet.
- [wrangler.toml](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/wrangler.toml): Worker configuration.
- [README.md](file:///Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form/README.md): Deployment and security guide.
