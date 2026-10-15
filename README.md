# Kick-Office

A dashboard for running an FRC kickoff. It works on every device, syncs live and needs no logins. When you open it you type your name and pick a view:

- **Presenter**: for the main screen (TV/projector). Collects everyone's questions and runs the shared chart, archetype board and prototypes.
- **Standard**: for each person's laptop or phone. Read the manual, send questions and ideas, follow along live and post prototype results.

## Pages

1. **Game Manual**: the presenter uploads the manual PDF; encrypted manuals ask for the passcode once, and every screen then opens it automatically. Anyone can send questions or prototyping ideas one at a time. Select text in the manual to attach it as a reference; clicking a reference jumps to and highlights that passage. The presenter sees every submission collected in one place. Includes the reader's search, contents, game elements and Focused View.
2. **Effort / Value**: the presenter lists robot abilities and rates effort and value on the Fibonacci scale (other numbers are rejected). The scatter plot updates live on every screen. Abilities with identical ratings share a marker with every name listed.
3. **Archetypes**: a Trello-style board. Drag abilities (each one can be reused) onto robot archetypes. The presenter's board is the master copy. Standard users can view it or build their own private board, which never affects the master.
4. **Prototypes**: the presenter turns questions and ideas into prototype tasks, edits them (edits show on the Game Manual page too), assigns people by name and tracks status. Anyone can open a prototype and post results, notes and photos.
5. **Tools**: strategy tools, starting with the **Field Board**. Kick-Office finds the top-down field drawing in the game manual (tested on the 2006, 2012, 2016, 2017, 2020 and 2026 manuals). The presenter confirms it, can re-crop it or pick another page, or uploads any image or PDF instead. Place red and blue robots, then draw freehand paths, straight lines and arrows. The presenter's board is shown live on every screen; Standard users can also sketch on their own private copy.

## Run locally

```bash
npm install
npm run dev
```

Without Supabase settings the app runs in **local mode**: data is saved in the browser and only syncs between tabs on the same computer, which is handy for trying it out.

## Set up syncing (free)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor**, paste in [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the table, turns on realtime and creates a public `kickoff` storage bucket.
3. Under **Project Settings → API**, copy the project URL and the anon (publishable) key.
4. For local development, copy `.env.example` to `.env.local` and fill both values in.

## Deploy to Vercel (free)

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com), choose **Add New → Project** and import the repo. Vercel detects Vite automatically.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then deploy.
4. Open the Vercel URL on the TV (Presenter) and share it with the team (Standard).

## Good to know

- There is no login, so anyone with the URL can view and edit. Only share it with your team.
- The manual's passcode is stored with the manual so other screens can open it.
- To start fresh next season, run `delete from public.kickoff_docs;` in the Supabase SQL editor.
