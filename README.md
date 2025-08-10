Magic Proxy App prototype

Stack: Next.js (App Router) + TypeScript + Tailwind + Prisma (SQLite)

Setup

1. Copy `.env`, set `OPENROUTER_API_KEY` (uses `openai/gpt-5-mini` model by default).
2. `npm install`
3. `npx prisma migrate dev`
4. `npm run dev`

Usage

- Paste plaintext deck. Optional `Commander: NAME`. Inline notes after `//` per card.
- Enter a theme. Generate to create proxy metadata per card.
- View JSON at `/api/decks/:id`. Export CSV via `/api/decks/:id/export?format=csv`.

Notes

- Legendary names must follow NAME, ROLE.
- Tokens are themed to match their source card.
- No images are generated or stored. Artist credits included in text fields.
