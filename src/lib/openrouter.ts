export type LlmCardInput = {
  original_name: string;
  type_line: string;
  mana_cost: string;
  rules_text: string;
  is_legendary: boolean;
  is_commander: boolean;
  color_identity: string[];
  token_hints?: Array<{ name: string; type_line: string; rulesText: string }>;
  user_note?: string;
  is_double_faced?: boolean;
  card_faces?: Array<{
    name: string;
    typeLine: string;
    rulesText: string;
    manaCost: string;
  }>;
  produces_tokens?: boolean;
  token_types?: Array<{ name: string; rulesText: string; typeLine: string }>;
};

export type LlmCardOutput = {
  original_name: string;
  thematic_name: string;
  mana_cost: string;
  type_line: string;
  rules_text: string;
  thematic_flavor_text: string;
  media_reference: string; // include artist credit
  midjourney_prompt: string; // must include --ar 3:5 and either --v 6 or --v 7
  card_faces?: Array<{
    thematic_name: string;
    thematic_flavor_text: string;
    media_reference: string;
    midjourney_prompt: string;
  }>;
  tokens?: Array<{
    thematic_name: string;
    thematic_flavor_text: string;
    media_reference: string;
    midjourney_prompt: string;
  }>;
};

export type LlmBatchResponse = {
  cards: LlmCardOutput[];
};

// Lightweight runtime validation with zod to catch malformed LLM JSON
import { z } from "zod";
const LlmCardOutputSchema = z.object({
  original_name: z.string(),
  thematic_name: z.string().default(""),
  mana_cost: z.string().default(""),
  type_line: z.string().default(""),
  rules_text: z.string().default(""),
  thematic_flavor_text: z.string().default(""),
  media_reference: z.string().default(""),
  midjourney_prompt: z.string().default(""),
  card_faces: z
    .array(
      z.object({
        thematic_name: z.string().default(""),
        thematic_flavor_text: z.string().default(""),
        media_reference: z.string().default(""),
        midjourney_prompt: z.string().default("")
      })
    )
    .optional(),
  tokens: z
    .array(
      z.object({
        thematic_name: z.string().default(""),
        thematic_flavor_text: z.string().default(""),
        media_reference: z.string().default(""),
        midjourney_prompt: z.string().default("")
      })
    )
    .optional(),
});
const LlmBatchResponseSchema = z.object({ cards: z.array(LlmCardOutputSchema) });

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number; maxRetries?: number } = {}) {
  const { timeoutMs = 30000, maxRetries = 2, ...rest } = init;
  const attempt = async (n: number): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(input, { ...rest, signal: controller.signal });
      if (resp.ok) return resp;
      if (n < maxRetries && (resp.status === 429 || resp.status >= 500)) {
        const backoff = Math.min(2000 * Math.pow(2, n), 8000);
        await new Promise((r) => setTimeout(r, backoff));
        return attempt(n + 1);
      }
      return resp;
    } finally {
      clearTimeout(timeout);
    }
  };
  return attempt(0);
}

function buildBatchPrompt(theme: string, cards: LlmCardInput[], deckIdea?: string): string {
  const header = `You are designing themed proxy cards for Magic: The Gathering.\nTheme: "${theme}".
${deckIdea ? `\nAdditional thematic guidance (apply across all cards):\n${deckIdea}\n` : ""}

## PRIMARY GOAL
Transform each original card into a **new, self-contained thematic version** that fits the chosen theme perfectly. Maintain mechanical equivalence while making names, flavor, and visuals feel like they belong entirely to the theme’s world.

## STEP 1 — BUILD AN INTERNAL STYLE_BIBLE
(Do not output the STYLE_BIBLE — use it to guide all decisions.)
STYLE_BIBLE must contain:
- CAST: 6–10 recurring characters/archetypes from the theme
- PROPS_MOTIFS: 10–15 signature props, locations, or running gags
- ART_STYLE_ANCHOR: 6–12 word description of the franchise’s visual look
- TONE: 5–8 adjectives defining humor and style of flavor text

Use STYLE_BIBLE consistently across the batch. Reuse CAST and PROPS_MOTIFS for cohesion but avoid exact repetition unless justified.

## STEP 2 — THEMATIC CONVERSION RULES
- **Never** reuse any part, sound, or spelling of the original card name.
- **Legendary cards**: Use Name, Role format. Both parts must be unique, concise, and thematic.
- Type alignment:
  * Creatures → characters or thematic beings
  * Artifacts → objects or thematic items
  * Spells → actions/events
  * Lands/Enchantments → flexible to fit theme
- Keep original rules text structure but rephrase names and flavor elements to fit the theme.

## STEP 3 — SPECIAL CARD HANDLING
- **Double-Faced Cards (DFC):**  
  Each face gets unique names, flavor text, media references, and Midjourney prompts.  
  The two faces must escalate the same gag or narrative (e.g., disguise → reveal).
- **Tokens:**  
  * Always generate thematic tokens for non-copy tokens.
  * Give each token a unique thematic name, flavor text, media reference, and Midjourney prompt.
  * Translate mechanics into visuals (see keyword mapping below Step 5).
  * Tokens must feel like natural extensions of the parent card’s theme.

## STEP 4 — FLAVOR TEXT
- Every flavor text must be a gag, pun, or witty punchline consistent with TONE.
- Avoid solemn lore unless TONE allows it.

## STEP 5 — MIDJOURNEY PROMPTS
- **Purpose:** Create a vivid, thematic visual description with no game mechanics.
- Begin with subject + action + prop-driven gag.
- Add environment from PROPS_MOTIFS.
- Add visual details from STYLE_BIBLE.
- Include ART_STYLE_ANCHOR verbatim.
- Forbid: “photorealistic”, “cinematic still”, “3D render”, logos, text.
- End with "--ar 3:5 --v 6" or "--ar 3:5 --v 7".

**Keyword → Visual Mapping:**  
Flying → soaring above, winged, aerial  
Vigilance → alert stance, watchful, vigilant  
First strike → quick reflexes, swift, precise  
Haste → energetic, dynamic, burst of speed  
Deathtouch → deadly, venomous, lethal  
Lifelink → radiant, glowing, life-giving

## STEP 6 — MEDIA REFERENCES
- Always provide a specific, accurate media reference that clearly fits the theme.
- Preferred source types: official artwork, comics, animation, illustrated books, concept art, trading cards, or other visually rich media that matches the style and tone.
- Use format: "Title by Artist, Publisher, Year" (e.g., "Avengers Reunited by Adi Granov, Marvel Comics, 2015").
- Research your STYLE_BIBLE to pick the most fitting existing work for each card — references must be real and verifiable, not invented.
- Only if no legitimate match exists for the theme after exhausting all reasonable possibilities, use the generic safe form: "Publisher (or IP owner), Year".
- Never invent credits, combine unrelated works, or use ambiguous placeholders.

## STEP 7 — OUTPUT RULES
Return **only** valid JSON with fields:
- original_name
- thematic_name
- mana_cost
- type_line
- rules_text
- thematic_flavor_text
- media_reference
- midjourney_prompt
- For DFC cards: "card_faces" array with above fields for each face.
- For token-producing cards: "tokens" array with above fields for each token.
`;
  const schema = `JSON Schema (conceptual):
{
  "cards": [
    {
      "original_name": "string",
      "thematic_name": "string",
      "mana_cost": "string",
      "type_line": "string",
      "rules_text": "string",
      "thematic_flavor_text": "string",
      "media_reference": "string",
      "midjourney_prompt": "string",
      "card_faces": [
        {
          "thematic_name": "string",
          "thematic_flavor_text": "string",
          "media_reference": "string",
          "midjourney_prompt": "string"
        }
      ],
      "tokens": [
        {
          "thematic_name": "string",
          "thematic_flavor_text": "string",
          "media_reference": "string",
          "midjourney_prompt": "string"
        }
      ]
    }
  ]
}`;
  const items = cards
    .map((c) => {
      const note = c.user_note ? `\nuser_note: ${c.user_note}` : "";
      const tokens = c.token_hints && c.token_hints.length
        ? `\ntoken_hints: ${c.token_hints.map((t) => `${t.name} (${t.type_line})${t.rulesText ? ` - ${t.rulesText}` : ''}`).join(", ")}`
        : "";
      const dfc = c.is_double_faced ? `\n  is_double_faced: true\n  card_faces: ${c.card_faces?.map(f => `${f.name} (${f.typeLine})`).join(", ")}` : "";
      const tokenProd = c.produces_tokens ? `\n  produces_tokens: true\n  token_types: ${c.token_types?.map(t => `${t.name} (${t.typeLine})${t.rulesText ? ` - ${t.rulesText}` : ''}`).join(", ")}` : "";
      return `- original_name: ${c.original_name}\n  type_line: ${c.type_line}\n  mana_cost: ${c.mana_cost}\n  rules_text: ${c.rules_text}\n  is_legendary: ${c.is_legendary}\n  is_commander: ${c.is_commander}\n  color_identity: [${c.color_identity.join(", ")}]${tokens}${dfc}${tokenProd}${note}`;
    })
    .join("\n");
  const instruction = `Return JSON ONLY for the following ${cards.length} cards in a single object: { "cards": [...] }`;
  return [header, schema, instruction, items].join("\n\n");
}

export async function callOpenRouterBatch(theme: string, cards: LlmCardInput[], deckIdea?: string): Promise<LlmBatchResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const prompt = buildBatchPrompt(theme, cards, deckIdea);

  const resp = await fetchWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Optional metadata to improve routing/quotas
      ...(process.env.NEXT_PUBLIC_APP_URL ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL } : {}),
      "X-Title": "Magic Proxy App",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful JSON generator that strictly follows schemas." },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
    timeoutMs: 30000,
    maxRetries: 2,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = LlmBatchResponseSchema.parse(JSON.parse(content));
  // Ensure midjourney constraints
  parsed.cards = parsed.cards.map((c) => ({
    ...c,
    thematic_name: (c.thematic_name || "").trim() || `Untitled ${theme} Concept`,
    midjourney_prompt: ensureMjParams(c.midjourney_prompt),
  }));
  return parsed;
}

function ensureMjParams(prompt: string): string {
  const hasAr = /--ar\s*3:5/.test(prompt);
  const hasV6 = /--v\s*6/.test(prompt);
  const hasV7 = /--v\s*7/.test(prompt);
  let out = prompt.trim();
  if (!hasAr) out += " --ar 3:5";
  if (!hasV6 && !hasV7) out += " --v 6"; // default to v6
  return out;
}

// named export already declared above
