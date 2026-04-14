# devix_research
Automator for deep research on multiple prompts using Google Gemini, replacing manual prompt injection on the Gemini web app.

## Stack
- Next.js 16.2.3 (App Router)
- TypeScript strict mode
- npm

## Commands
- `npm run dev` - dev server (localhost:3000)
- `npm run build` - production build
- `npm run lint` - ESLint

## Structure
- `app/` - pages and components
- `public/` - static assets
- `docs/` - reference docs (@docs/filename.md)

## Rules
- TypeScript strict - no `any`
- Named exports only
- Never commit .env* files
