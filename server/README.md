# Ervo's AI server, and how to turn on each sync

Ervo 0.2.0 already understands everyday requests on the phone (what you want, the day, time, number of people, the item) and works with Google Calendar, Amazon, Health Connect, location and email after you tap **Allow**. This page explains what's live today and what you need to set up for the rest.

## What works today, with no setup

| Sync | How it works now | Android | iPhone |
|---|---|---|---|
| Google Calendar | Ervo opens Google Calendar with the event already filled in; you tap Save | ✅ | ✅ |
| Amazon | Ervo opens Amazon search results, or your orders for returns and tracking | ✅ | ✅ |
| Steps | Read from Health Connect, after Ervo and the phone both ask | ✅ | ❌ (needs the App Store app) |
| Weather | Your city (never your exact address) plus Open-Meteo, a free weather service | ✅ | ✅ |
| News | Opens Google News for your city. With the AI server, Ervo writes the headlines itself | ✅ | ✅ |
| Email (Business) | Opens your email app with Ervo's draft filled in | ✅ | ✅ |

## Step 1: turn on the real AI (about 15 minutes)

This makes Ervo answer any question, not just the built-in ones. The key that pays for it stays on this server, never in the app.

1. **Get an API key.** Make an account at [console.anthropic.com](https://console.anthropic.com), add a payment method, and create an API key. In **Limits**, set a monthly spend limit (for example, $10) so it can never surprise you.
2. **Make a free Cloudflare account** at [dash.cloudflare.com](https://dash.cloudflare.com).
3. **Install Node.js** (the LTS version) from [nodejs.org](https://nodejs.org).
4. **Deploy the server.** In a terminal, in this `server` folder:
   ```bash
   npm install
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler deploy
   ```
   When it asks for the secret, paste your API key. The last command prints your server's address, like `https://ervo-ai.your-name.workers.dev`.
5. **Point the app at it.** Put that address in `docs/app/config.js`:
   ```js
   window.ERVO_CONFIG = { aiUrl: "https://ervo-ai.your-name.workers.dev" };
   ```
   Push it to GitHub. The iPhone app updates on its own; for Android, publish a new release.

**Safety built in:** only Ervo's own app can use the server, each phone is limited to 20 messages a minute, and your spend limit caps the bill.

## Step 2: real two-way syncing (later, one at a time)

These let Ervo read and change things for you without opening the other app. Each one needs a developer account with that company and, for the big ones, a review before the public can use it. Ervo would also need real sign-in (step 3) first, so each person's data stays theirs.

| Sync | What you sign up for | Cost | Notes |
|---|---|---|---|
| Google Calendar (read your schedule, add events directly) | A Google Cloud project with the Calendar API and an OAuth sign-in screen | Free | Google reviews apps that read calendars. Up to 100 test users work before review. |
| Gmail (Business) | Same Google Cloud project, Gmail API | Free, but the review is strict | Reading email needs a yearly security assessment. Sending drafts is easier. |
| Amazon orders | No public API for shoppers' orders | — | Amazon doesn't let other apps read personal orders or check out. Opening Amazon (what Ervo does now) is the allowed way. |
| Restaurant booking | OpenTable or Resy partner programs | Varies | Partner approval required. Until then, Ervo plans it and opens Maps to find a table. |
| Steps on iPhone | Apple Developer Program, plus a Mac with Xcode | $99 a year | Apple only shares Health data with installed App Store apps, not web apps. |
| Fingerprint and Face ID sign-in | Android: nothing extra. iPhone: same as above | — | Planned for a later version. |

## Step 3: real accounts with Supabase (about 10 minutes)

Ervo's app is already built for this: once it has your project's two public values, sign-in sends a real 6-digit code by email, and each person's name and Personal/Business choice are saved to their account.

1. **Create the project.** In [supabase.com/dashboard](https://supabase.com/dashboard), click **New project**.
   - Name: `Ervo`
   - Database password: click **Generate a password** and save it somewhere safe (a password manager). Ervo doesn't need it, but you will later.
   - Region: the one closest to you (for Texas, **East US** or **Central US**).
   - Click **Create new project** and wait a minute or two.
2. **Turn on email codes.** Go to **Authentication → Sign In / Providers**, and make sure **Email** is on. Turn **Confirm email** on.
3. **Make the email show a code instead of a link.** Go to **Authentication → Emails** (Templates), open **Magic Link**, and replace its body with:
   ```html
   <h2>Your Ervo code</h2>
   <p>Enter this code in Ervo to sign in:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>It expires in 1 hour. If you didn't ask for it, you can ignore this email.</p>
   ```
   Set the subject to `Your Ervo code`. Do the same for **Confirm signup**, so new people get a code too. Save both.
4. **Check the code length.** In **Authentication → Sign In / Providers → Email**, set **Email OTP length** to `6`.
5. **Copy the two public values.** Go to **Project Settings → API Keys** (or **Data API**):
   - **Project URL**, like `https://abcdefgh.supabase.co`
   - **Publishable key** (or the **anon public** key)

   Put them in `docs/app/config.js`, or send them to Claude to add:
   ```js
   supabaseUrl: "https://abcdefgh.supabase.co",
   supabaseKey: "sb_publishable_...",
   ```
   These two are safe to be public. **Never** put the `service_role` or **secret** key in the app, the repo or a chat.

**Good to know:**
- Supabase's built-in email only sends to your own team's addresses, and only a few emails an hour. That's perfect for testing with your own email. Before other people sign up, connect a free email sender like [Resend](https://resend.com) in **Authentication → Emails → SMTP Settings**.
- Text message codes need a texting service like Twilio, which costs money per text. For now Ervo asks people to sign in with email when Supabase is on.
- Fingerprint and Face ID sign-in come later, on top of these accounts.
