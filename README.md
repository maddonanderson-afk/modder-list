# People List — Cloudflare Workers + D1 + Google OAuth

A small full-stack people list.

## Features

- Google OAuth login
- ADD YOURSELF button
- REMOVE YOURSELF button
- Cloudflare D1 persistence
- Server-side sessions
- PKCE + OAuth state protection
- Duplicate-account protection
- Public list only exposes display name + profile picture
- Users can only remove their own entry

## 1. Create the D1 database

Install Node.js and Wrangler if you do not already have them:

```bash
npm install
```

Log into Cloudflare:

```bash
npx wrangler login
```

Create the database:

```bash
npx wrangler d1 create people-list-db
```

Cloudflare will print a database ID. Put that ID into `wrangler.toml`:

```toml
database_id = "YOUR_REAL_DATABASE_ID"
```

Then initialize the schema:

```bash
npx wrangler d1 execute people-list-db --remote --file=./schema.sql
```

## 2. Create Google OAuth credentials

In Google Cloud Console:

1. Create/select a project.
2. Configure the OAuth consent screen.
3. Create an OAuth Client ID.
4. Choose "Web application".
5. Add this Authorized redirect URI:

```text
https://YOUR-DOMAIN.example/auth/callback
```

For local Wrangler development, use a separate OAuth client or add the local callback URI:

```text
http://localhost:8787/auth/callback
```

Google may require additional consent-screen configuration depending on whether the app is in testing or production.

## 3. Add Cloudflare secrets

Set these from your terminal:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

For SESSION_SECRET, use a long random value. Example:

```bash
openssl rand -base64 48
```

Do NOT put the Google client secret in `public/app.js`, HTML, or any file sent to visitors.

## 4. Deploy

```bash
npm run deploy
```

Your Cloudflare Worker will serve the site and the API from the same domain.

## 5. How it works

Visitor clicks:

ADD YOURSELF

↓

Cloudflare Worker sends them to Google

↓

Google authenticates them

↓

Google redirects to:

/auth/callback

↓

Worker verifies the OAuth state + PKCE verifier

↓

Worker retrieves the verified Google account

↓

Worker creates a signed HTTP-only session cookie

↓

The visitor returns to the site

↓

They can click ADD YOURSELF

↓

Their Google display name and profile picture are stored in D1

The public API never returns the Google email address.

## Important

The Google OAuth redirect URI must exactly match the domain you use.

If your production site is:

https://example.com

then use:

https://example.com/auth/callback

Do not use a wildcard redirect URI.
