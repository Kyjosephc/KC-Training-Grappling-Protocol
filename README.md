# KC Grappling Protocol — Deployment Guide

This version has real, independent accounts. Every person who signs up gets
their own permanently saved data, on any device — and you, as the coach, can
see a summary of anyone who chooses to share their progress with you.

## Part 1 — Create your Supabase project (the database + accounts)

1. Go to https://supabase.com and sign up (free tier is enough for this)
2. Click **New Project**
3. Give it a name (anything, e.g. "kc-grappling-protocol"), set a database
   password (save it somewhere), pick the region closest to you, click
   **Create new project** — it takes about 2 minutes to spin up
4. Once it's ready, in the left sidebar click the **SQL Editor** icon
5. Click **New query**
6. Open the file `supabase-schema.sql` from this project folder, copy
   everything in it, paste it into the SQL editor, and click **Run**
   (bottom right). You should see "Success. No rows returned."
7. In the left sidebar, click **Project Settings** (gear icon) → **API**
8. You'll see a **Project URL** and an **anon public** key — copy both,
   you'll need them in Part 3

By default, Supabase requires people to confirm their email before signing
in. If you'd rather they can start immediately: **Authentication** (left
sidebar) → **Providers** → **Email** → turn off "Confirm email." You can
always turn it back on later.

## Part 2 — Get this code onto GitHub

Same as before if you've already done this once:
```
git init
git add .
git commit -m "Real accounts with Supabase"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/kc-strength-web.git
git push -u origin main
```
If you already have this repo from before, just run:
```
git add .
git commit -m "Add real accounts with Supabase"
git push
```

## Part 3 — Add your Supabase keys to Vercel

1. Go to your project on https://vercel.com
2. Click **Settings** → **Environment Variables**
3. Add two variables, pasting in the values you copied in Part 1, step 8:
   - Name: `VITE_SUPABASE_URL` — Value: your Project URL
   - Name: `VITE_SUPABASE_ANON_KEY` — Value: your anon public key
4. Click **Save** for each
5. Go to the **Deployments** tab, click the **...** menu on the latest
   deployment, and click **Redeploy** (environment variables only take
   effect on a new deployment)

## Part 4 — Test it

Open your live site. You should see a sign-in screen. Click "New here?
Create an account," sign up with any email and password, and you'll land on
your own onboarding screen — completely separate from anyone else who signs
up later.

## How clients use this

Send them your site's URL. Each person creates their own account (their own
email and password) and gets their own private profile — nobody else can
see their data, including you, unless they choose to share it (next
section).

## How you track client progress (Coach Dashboard)

1. Pick a roster code — anything memorable, like your gym's name plus a
   number (e.g. `KCGRAPPLING1`)
2. Give that code to your clients
3. Each client goes to **Settings → Share Progress With Your Coach**, enters
   that same code, and turns sharing on
4. You go to **Settings → Open Coach Dashboard**, enter your roster code,
   and see a live summary of everyone who's shared with it — current week,
   workout count, last session, and recent Personal Records

Only that summary is shared — full workout-by-workout detail always stays
private to the client.

## Running it locally first (optional but recommended)

```
cp .env.example .env
```
Then edit `.env` and paste in your real Supabase URL and key. Then:
```
npm install
npm run dev
```

## A note on cost

Supabase's free tier covers a generous amount of usage — almost certainly
enough for a single gym's worth of clients. If you ever outgrow it, it's a
simple paid upgrade rather than a rebuild.
