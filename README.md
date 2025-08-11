Magic Proxy App prototype

Stack: Next.js (App Router) + TypeScript + Tailwind + Prisma (SQLite)

Setup

1. Copy `.env`, set `OPENROUTER_API_KEY` (uses `openai/gpt-5-mini` model by default).
2. `npm install`
3. `npx prisma migrate dev`
4. `npm run dev`

Usage

- Paste plaintext deck. Optional `Commander: NAME`. Inline notes after ` ; ` per card (semicolon).
- Enter a theme. Generate to create proxy metadata per card.
- View JSON at `/api/decks/:id`. Export CSV via `/api/decks/:id/export?format=csv.

Notes

- Legendary names must follow NAME, ROLE.
- Tokens are themed to match their source card.
- No images are generated or stored. Artist credits included in text fields.

## Copy Token Filtering

The application intelligently filters out tokens that are just copies of the original card, preventing redundant proxy generation. This is especially useful for cards like Scute Swarm that create token copies of themselves.

### How It Works

1. **Pattern Detection**: Analyzes card rules text using regex patterns to identify self-copying mechanics
2. **Token Similarity Analysis**: Compares token names, type lines, and rules text to determine if they're copies
3. **Smart Filtering**: Preserves meaningful tokens (creatures, objects) while filtering out copy tokens

### Enhanced Token Information

When meaningful tokens exist, the system now includes:
- **Token Rules Text**: Abilities like flying, vigilance, etc. are captured and displayed
- **Type Line Information**: Complete token type information for better context
- **Conditional Display**: Token sections only appear when meaningful tokens exist

### Examples

- **Historian's Boon**: Shows Soldier and Angel tokens with their abilities (flying, vigilance)
- **Pack Rat**: Hides token section entirely since only copy tokens are produced
- **Scute Swarm**: Filters out copy tokens, preserves insect tokens if they exist

### Technical Implementation

The filtering logic is implemented in `src/lib/scryfall.ts` with three main functions:
- `filterCopyTokens()`: Main filtering logic
- `detectSelfCopyMechanics()`: Rules text analysis
- `isSelfCopyToken()`: Token similarity assessment
