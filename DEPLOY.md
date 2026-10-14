# Deploying to Vercel via GitHub

Your GitHub repository is pushed and up to date:
[https://github.com/The-soof/Rush-Voting](https://github.com/The-soof/Rush-Voting)

Because the project is on GitHub, Vercel gives you free 24/7 uptime and automatic deployments every time you push changes to `main`.

---

## Simple 1-Minute Vercel Setup

1. Go to **[vercel.com/new](https://vercel.com/new)**.
2. Under **Import Git Repository**, select **The-soof / Rush-Voting** and click **Import**.
3. In the **Environment Variables** section, add these two variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://kslcqdvmhezirixlcnpz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<your-supabase-anon-key>`
4. Click **Deploy**.

---

## How It Works in Production
- Vercel gives you a public URL (e.g. `https://rush-voting-the-soof.vercel.app`).
- When you open `/admin` on that public URL, the QR code automatically encodes `https://rush-voting-the-soof.vercel.app/vote` (using `window.location.origin`).
- Voters can scan the QR code from their mobile phones anywhere on cellular or Wi-Fi without needing to be on the same local network.
- Any future changes you commit and push to `main` (`git push origin main`) will automatically build and deploy to Vercel.
