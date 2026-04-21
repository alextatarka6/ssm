# Deploy To AWS Amplify Hosting

This frontend is a static React + Vite app located in `server/frontend`.

## Required Environment Variables

Set these in the Amplify Hosting app's build environment:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_API_BASE_URL=https://your-backend.example.com/api
```

Notes:

- Only `VITE_*` variables are exposed to the browser build.
- `VITE_API_BASE_URL` should point to the deployed backend API, usually ending in `/api`.
- The app now fails with a clear in-browser configuration message if any required variable is missing or invalid.

## Build Settings

- Build command: `npm run build --prefix server/frontend`
- Output directory: `server/frontend/dist`

This repo includes [amplify.yml](/home/inferno/projects/ssm/amplify.yml), so Amplify can use the repo-defined build settings directly.

## Rewrite Rule

This app is a client-rendered SPA. Add this rewrite rule in the Amplify Hosting console:

- Source address: `</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|json|png|svg|txt|webp|woff2?)$)([^.]+$)/>`
- Target address: `/index.html`
- Type: `200 (Rewrite)`

If you prefer a simpler catch-all rule and do not serve additional non-HTML routes from the same host, this also works:

- Source address: `/<*>`
- Target address: `/index.html`
- Type: `200 (Rewrite)`

## Amplify Console Settings

- Framework preset: `Vite` or `None`
- Root directory: leave as the repository root when using `amplify.yml`
- Build image/runtime: use a Node.js version compatible with Vite 8, such as Node 20

## Result

- Static assets are built into `server/frontend/dist`
- The app serves from `/` with no GitHub Pages base-path dependency
- API and Supabase configuration come only from frontend build-time environment variables
