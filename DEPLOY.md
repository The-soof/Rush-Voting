# Deploying to Vercel

The Vercel CLI is installed globally (`vercel --version`).

## Option 1: CLI
```bash
vercel login                      # opens browser, one time
vercel link                       # create/link the project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel --prod
```
Use `https://kslcqdvmhezirixlcnpz.supabase.co` (no `/rest/v1/`) as the URL.

## Option 2: GitHub (auto-deploys on every push)
```bash
git remote add origin https://github.com/<you>/bid-vote.git
git push -u origin main
```
Then import the repo at https://vercel.com/new and add the same two env vars.

The QR code uses `window.location.origin`, so open `/admin` on the deployed
URL and phones will be sent to `<deployed-url>/vote` automatically.
