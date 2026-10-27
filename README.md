# PAVE Case Book Form Deployment Guide

This project provides a complete replication of the PAVE Case Book entry form (`u7vQQNPRhpus`) configured to submit directly to your NocoDB database (`p1t9vvz76dbkcv8`), hosted on **Cloudflare Workers**.

---

## 1. Architecture & Security Controls

- **Frontend (`public/`)**: Clean, accessible HTML form with responsive layouts, multi-step sections (Nomination vs Full Case study), participant group repeater, and resource manager.
- **Organisation Search & Deduplication**: Real-time debounced search against NocoDB's `Organisations` table (`mecsh2ykfxm0s2f`). Displays existing matches and dynamically allows adding a new organisation *only* if no exact match exists.
- **Security Hardening Applied**:
  - **Filter Injection Prevention (1.B)**: Search queries strip syntax control characters `(`, `)`, `~`, `,`, quotes, and backslashes before reaching NocoDB.
  - **Enumeration & Scrape Mitigation (1.C)**: Minimum 2 characters required before querying NocoDB. Empty searches are blocked.
  - **Strict URL Validation (3.B)**: Only `http://` and `https://` schemes are accepted for Project URLs and Resource links (blocking `javascript:`/data URI vectors).
  - **Payload Limits & Schema Enforcement (3.A)**: 100 KB payload ceiling, bounded array lengths (max 15 participant groups, max 20 resources, max 20 organisations), clamped integer/string bounds.
  - **Information Disclosure Prevention (3.C)**: Internal database errors, field keys, and stack traces are logged only in Cloudflare console logs; clients receive sanitized, safe responses.
  - **CORS Handling**: Permissive `Access-Control-Allow-Origin: *` enabled for development and testing.
  - **Edge Caching**: Search results are cached for 60 seconds via `Cache-Control: public, max-age=60` to reduce unnecessary load on NocoDB.

---

## 2. Prerequisites

1. **Cloudflare Account**: [Sign up for free](https://dash.cloudflare.com/) if you haven't already.
2. **Node.js**: Node 18+ (Node 26 is installed locally).
3. **NocoDB API Token**: A scoped token with write permissions to base `p1t9vvz76dbkcv8`.

---

## 3. How to Obtain Your NocoDB API Token

1. Log into your NocoDB dashboard: [app.nocodb.com](https://app.nocodb.com).
2. Go to **Base Settings** -> **API Tokens** for base `p1t9vvz76dbkcv8`.
3. Create a **Base Scoped API Token** (e.g. named `pave-form-worker`) with Editor/Creator permissions (avoiding Workspace Admin tokens for least privilege).
4. Copy the generated token string.

---

## 4. Local Development

1. Open a terminal in the project directory:
   ```bash
   cd /Users/admin/Documents/ConnectedByData/CitizensTrack/PAVE-form
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a local environment variables file (`.dev.vars`) for Wrangler:
   ```bash
   echo "NOCODB_API_TOKEN=your_nocodb_token_here" > .dev.vars
   ```

4. Run the local development server:
   ```bash
   npm run dev
   ```
   Wrangler will launch a local server (typically at `http://localhost:8787`). You can test the form, search organisations, and test case submissions against NocoDB.

---

## 5. Cloudflare Deployment Instructions

### Step 5.1: Authenticate with Cloudflare
If you haven't logged in with Wrangler on this machine yet, run:
```bash
npx wrangler login
```

### Step 5.2: Set the NocoDB API Secret
Store your NocoDB token as an encrypted Cloudflare secret:
```bash
npx wrangler secret put NOCODB_API_TOKEN
```
When prompted, paste your NocoDB token and press Enter.

### Step 5.3: Deploy to Cloudflare
Deploy the Worker and static assets with one command:
```bash
npm run deploy
```
*(or `npx wrangler deploy`)*

Wrangler will output your live URL, e.g.:
```text
Uploaded pave-casebook-form (X.XX sec)
Deployed pave-casebook-form triggers
  https://pave-casebook-form.<your-subdomain>.workers.dev
```

---

## 6. Cloudflare Dashboard Security Recommendation (Rate Limiting)

To prevent automated denial-of-service or database spam:
1. In the Cloudflare Dashboard, navigate to **Security** -> **WAF** -> **Rate Limiting Rules**.
2. Click **Create rule**:
   - **Name**: `Protect PAVE Form Submissions`
   - **Matching expression**: `(http.request.uri.path eq "/api/submit" and http.request.method eq "POST")`
   - **Rate limit**: e.g. 5 requests per 10 minutes per IP address.
   - **Action**: Block / Managed Challenge.
