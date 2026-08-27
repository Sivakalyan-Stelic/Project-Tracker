# Stelic Portfolio Delivery Roadmap

An editable weekly gate roadmap that runs as a single page. Hosted on Vercel it stores one
shared JSON document so everyone sees the same data, and an admin passcode controls who can edit.
Opened as a local file it falls back to this-browser storage and stays fully editable.

## What is in here

    public/index.html   The dashboard (also works standalone if you just open it in a browser)
    api/state.js        Serverless function: reads and writes the shared JSON in Vercel Blob
    dataset.json        A copy of the starting data (the app also seeds itself on first admin save)
    package.json        Declares the @vercel/blob dependency and Node 20
    vercel.json         Minimal function config

## How storage works

- The shared roadmap is a single JSON object kept in Vercel Blob at `stelic-roadmap/dataset.json`.
- `GET /api/state` returns the current JSON to anyone (this is how viewers load the board).
- `POST /api/state` writes the JSON, and is rejected unless the request carries the admin passcode.
- The dashboard also caches the latest copy in the browser, so a brief network blip does not lose work.

## Deploy on Vercel

1. Put these files in a folder (or a Git repo) and import it into Vercel, or run `vercel` from the folder.
2. In the Vercel project, open Storage and create a Blob store, then connect it to this project.
   That adds the `BLOB_READ_WRITE_TOKEN` environment variable automatically.
3. Add one more environment variable:
       ADMIN_PASSCODE = choose-a-strong-passphrase
   Set it for Production (and Preview if you use previews). Redeploy after adding it.
4. Open the deployed URL. It loads read only. Click "Admin sign in" and enter the passcode to edit.

Local development: `npm install`, then `vercel dev`, then open the printed localhost URL.

## Who can do what

- Anyone with the link can view the roadmap and read comments. They cannot change anything.
- An admin clicks "Admin sign in", enters the passcode, and can then edit gates, add and remove
  weeks, move projects, edit names, and add comments. Every change saves to the shared store.
- The pill at the top right shows the current state: Shared admin, Shared view only, or Local copy.
- Viewers auto refresh about every 20 seconds, so they pick up an admin's changes without reloading.

## Changing the passcode

Update the `ADMIN_PASSCODE` environment variable in Vercel and redeploy. Anyone currently signed in
stays signed in only for their browser session; a new value takes effect on their next sign in.

## Privacy note

The shared JSON is stored as a public Blob, which means it is readable by anyone who has the exact,
unguessable Blob URL. Edits are always protected by the passcode. For a roadmap this is usually fine.
If you need the data itself to be non public, switch the store to a private Blob or a Marketplace
database (Upstash or Neon) and read it server side only. Ask and I can adjust `api/state.js` for that.

## Resetting the data

To reload the starting data, an admin can use Import JSON in the toolbar and pick `dataset.json`,
then it saves to the shared store. Export JSON downloads the current shared data as a file at any time.
