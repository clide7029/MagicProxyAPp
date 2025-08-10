export type ScryfallIdentifier =
  | { name: string }
  | { id: string }
  | { oracle_id: string }
  | { set: string; collector_number: string };

export type ScryfallCard = {
  id: string;
  oracle_id: string;
  name: string;
  type_line: string;
  mana_cost?: string;
  cmc?: number;
  color_identity?: string[];
  oracle_text?: string;
  all_parts?: Array<{ id: string; component: string; name: string; type_line: string }>;
  card_faces?: Array<{
    name: string;
    type_line: string;
    mana_cost?: string;
    oracle_text?: string;
  }>;
};

export type ScryfallCollectionResponse = {
  data: ScryfallCard[];
  not_found?: Array<Record<string, string>>;
};

export async function fetchScryfallCollection(identifiers: ScryfallIdentifier[]): Promise<ScryfallCollectionResponse> {
  const resp = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
    // Scryfall terms allow caching; but avoid aggressive retries here
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Scryfall error ${resp.status}: ${text}`);
  }
  return (await resp.json()) as ScryfallCollectionResponse;
}

export function extractPrimaryText(card: ScryfallCard): { rulesText: string; typeLine: string; manaCost: string; cmc: number } {
  if (card.card_faces && card.card_faces.length > 0) {
    const text = card.card_faces.map((f) => f.oracle_text || "").filter(Boolean).join(" // ");
    const mana = card.card_faces.map((f) => f.mana_cost || "").filter(Boolean).join(" // ");
    return {
      rulesText: text,
      typeLine: card.type_line,
      manaCost: mana,
      cmc: typeof card.cmc === "number" ? card.cmc : 0,
    };
  }
  return {
    rulesText: card.oracle_text || "",
    typeLine: card.type_line,
    manaCost: card.mana_cost || "",
    cmc: typeof card.cmc === "number" ? card.cmc : 0,
  };
}

export function getGeneratedTokenHints(card: ScryfallCard): Array<{ name: string; type_line: string }> {
  // Use all_parts for token relationships when available
  const parts = card.all_parts || [];
  return parts
    .filter((p) => p.component === "token")
    .map((p) => ({ name: p.name, type_line: p.type_line }));
}

export async function fetchScryfallNamedFuzzy(name: string): Promise<ScryfallCard | null> {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
  const resp = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!resp.ok) return null;
  const data = (await resp.json()) as (ScryfallCard & { object?: string }) | { object?: string; details?: string };
  if (data && "object" in data && data.object === "error") return null;
  return data as ScryfallCard;
}


