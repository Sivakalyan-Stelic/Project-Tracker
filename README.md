# Stelic Portfolio Roadmap (flat layout)

Same live, password-protected, GitHub-stored roadmap, with no public folder.

    index.html      the dashboard (served at / because it sits at the root)
    api/state.js    the server piece that reads and writes roadmap.json in GitHub
    roadmap.json    your data, to commit into the GitHub data repo
    package.json    Node 20, no dependencies
    vercel.json     minimal function config

The api folder is the one thing that must stay. Vercel only turns a file into a server function when
it is inside a folder named api, and that function is what keeps the GitHub token on the server and
checks the password. Removing it would mean each editor pastes a GitHub token instead of a password.

## Setup

1. DATA repo: create a repo (private is fine), upload roadmap.json to it.
2. Token: a fine-grained GitHub token with Contents read and write on that data repo.
3. Deploy this folder to Vercel (framework preset Other). index.html serves at /, api/state.js becomes /api/state.
4. Set env vars, then redeploy:
       ADMIN_PASSWORD = stelic@2026
       GITHUB_TOKEN   = your token
       GITHUB_REPO    = owner/DATA-repo
5. Open the site, click Admin, type the password, edit. Changes commit to roadmap.json and everyone
   with the link sees them within about 20 seconds.

Keep the data in a separate repo from this app so a save does not redeploy the site.
