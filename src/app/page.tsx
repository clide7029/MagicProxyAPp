"use client";
import { useEffect, useMemo, useState } from "react";
import { parseDeckText } from "@/lib/deck-parse";
import DeckList from "@/app/components/DeckList";

type GenerateResponse = { deckId: string } | { error: string };
type DeckResponse = {
  id: string;
  name: string;
  theme: string;
  cards: Array<{
    id: string;
    originalName: string;
    manaCost: string;
    typeLine: string;
    rulesText: string;
    colorIdentity: string;
    cmc: number;
    isCommander: boolean;
    isDoubleFaced: boolean;
    powerToughness?: string;
    cardFaces?: Array<{
      name: string;
      typeLine: string;
      rulesText: string;
      manaCost: string;
      powerToughness?: string;
    }>;
    producesTokens: boolean;
    tokenTypes?: Array<{ name: string; rulesText: string; powerToughness: string; colorIdentity: string; typeLine: string }>;
    proxyIdeas: Array<{
      thematicName: string;
      thematicFlavorText: string;
      mediaReference: string;
      midjourneyPrompt: string;
      version: number;
      // For DFC cards, each face gets its own fields
      cardFaces?: Array<{
        thematicName?: string;
        thematicFlavorText?: string;
        mediaReference?: string;
        midjourneyPrompt?: string;
        // Also support snake_case keys from LLM
        thematic_name?: string;
        thematic_flavor_text?: string;
        media_reference?: string;
        midjourney_prompt?: string;
      }>;
      // For token-producing cards
      tokens?: Array<{
        thematicName?: string;
        thematicFlavorText?: string;
        mediaReference?: string;
        midjourneyPrompt?: string;
        // Also support snake_case keys from LLM
        thematic_name?: string;
        thematic_flavor_text?: string;
        media_reference?: string;
        midjourney_prompt?: string;
      }>;
    }>;
  }>;
};

// Helpers to align generated token writeups to actual token types
function extractSubtypeWordsFromTypeLine(typeLine: string): string[] {
  // Expect formats like "Token Creature — Angel" or "Token Legendary Creature — Eldrazi Spawn"
  const afterDash = typeLine.split("—")[1]?.trim().toLowerCase() || "";
  if (!afterDash) return [];
  const words = afterDash.split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (afterDash && !words.includes(afterDash)) {
    // keep compound (e.g., "eldrazi spawn") as full phrase too
    words.push(afterDash);
  }
  return Array.from(new Set(words));
}

function getSubtypeSynonyms(word: string): string[] {
  const map: Record<string, string[]> = {
    angel: ["angel", "seraph", "seraphim", "archangel"],
    soldier: ["soldier", "trooper", "guard", "marshal", "legionnaire", "sentinel"],
    goblin: ["goblin"],
    zombie: ["zombie"],
    spirit: ["spirit"],
    elf: ["elf", "elven"],
    merfolk: ["merfolk"],
    vampire: ["vampire"],
    dragon: ["dragon"],
    eldrazi: ["eldrazi"],
    spawn: ["spawn"],
  };
  return map[word] || [word];
}

type TokenIdea = {
  thematicName?: string;
  thematicFlavorText?: string;
  mediaReference?: string;
  midjourneyPrompt?: string;
  thematic_name?: string;
  thematic_flavor_text?: string;
  media_reference?: string;
  midjourney_prompt?: string;
};

function scoreTokenIdeaAgainstType(tokenIdea: TokenIdea, tokenType: { name: string; typeLine: string; powerToughness?: string }): number {
  const haystack = [
    tokenIdea?.thematicName,
    tokenIdea?.thematic_name,
    tokenIdea?.thematicFlavorText,
    tokenIdea?.thematic_flavor_text,
    tokenIdea?.midjourneyPrompt,
    tokenIdea?.midjourney_prompt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const subtypeWords = extractSubtypeWordsFromTypeLine(tokenType.typeLine);
  let score = 0;
  for (const w of subtypeWords) {
    const synonyms = getSubtypeSynonyms(w);
    if (synonyms.some((syn) => haystack.includes(syn))) score += 3;
    if (haystack.includes(w)) score += 2;
  }
  // slight boost if P/T appears in text
  if (tokenType.powerToughness && haystack.includes(tokenType.powerToughness)) score += 1;
  // slight boost if type's name appears
  if (tokenType.name && haystack.includes(tokenType.name.toLowerCase())) score += 1;
  return score;
}

function orderTokenTypesToIdeas(tokens: TokenIdea[] | undefined, tokenTypes: Array<{ name: string; rulesText: string; powerToughness: string; colorIdentity: string; typeLine: string }>): Array<typeof tokenTypes[number] | undefined> {
  if (!tokens || tokens.length === 0) return tokenTypes;
  const remaining = tokenTypes.map((t, i) => ({ idx: i, t }));
  const ordered: Array<typeof tokenTypes[number] | undefined> = [];
  for (const idea of tokens) {
    if (remaining.length === 0) {
      ordered.push(undefined);
      continue;
    }
    let best = { score: -1, idxInRemaining: 0 };
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i].t;
      const s = scoreTokenIdeaAgainstType(idea, candidate);
      if (s > best.score) best = { score: s, idxInRemaining: i };
    }
    const chosen = remaining.splice(best.idxInRemaining, 1)[0];
    ordered.push(chosen?.t);
  }
  return ordered;
}

export default function Home() {
  const [theme, setTheme] = useState("Star Wars Empire");
  const [deckName, setDeckName] = useState("Imperial Expansion");
  const [deckText, setDeckText] = useState(`Commander: Szarel, Genesis Sheperd ; Palpatine
Scute Swarm
Walk-In Closet // Forgotten Cellar
The Kami War
1 Three Blind Mice
Beast Within
Rise of the Dalek`);
  const [deckIdea, setDeckIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [deck, setDeck] = useState<DeckResponse | null>(null);
      const [sortBy, setSortBy] = useState<"type" | "cmc" | "name" | "nickname">("type");
    const [selectedVersionByCard, setSelectedVersionByCard] = useState<Record<string, number>>({});
    const [detailedView, setDetailedView] = useState(true);
    const [loadingByCard, setLoadingByCard] = useState<Record<string, boolean>>({});

  async function handleGenerate() {
    setError(null);
    setLoading(true);
    try {
      const parsedLines = parseDeckText(deckText);
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckName, theme, deckIdea, parsedLines }),
      });
      const text = await resp.text();
      let data: (GenerateResponse & { not_found?: string[] }) | null = null;
      try { data = JSON.parse(text); } catch { /* non-JSON */ }
      if (!data) {
        throw new Error(text?.slice(0, 200) || "Server returned non-JSON response");
      }
      if (!resp.ok) {
        const err = (data as { error?: string }).error ?? "Failed";
        throw new Error(err);
      }
      setDeckId((data as { deckId: string }).deckId);
      const nf = (data as { not_found?: string[] }).not_found;
      if (Array.isArray(nf) && nf.length) {
        setError(`Not found: ${nf.join(", ")}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!deckId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const resp = await fetch(`/api/decks/${deckId}`, { signal: controller.signal });
        const data = (await resp.json()) as DeckResponse;
        setDeck(data);
      } catch {
        // ignore
      }
    })();
    return () => controller.abort();
  }, [deckId]);

  // sorting handled inside DeckList

  async function reroll(cardId: string) {
    if (!deck) return;
    try {
      setLoadingByCard((prev) => ({ ...prev, [cardId]: true }));
      await fetch(`/api/reroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckCardId: cardId, theme }),
      });
      const refreshed = await fetch(`/api/decks/${deck.id}`);
      const data = (await refreshed.json()) as DeckResponse;
      setDeck(data);
      // Set selection to latest version for this card
      const refreshedCard = data.cards.find((c) => c.id === cardId);
      if (refreshedCard && refreshedCard.proxyIdeas.length) {
        const latestVersion = Math.max(...refreshedCard.proxyIdeas.map((p) => p.version));
        setSelectedVersionByCard((prev) => ({ ...prev, [cardId]: latestVersion }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reroll failed");
    } finally {
      setLoadingByCard((prev) => ({ ...prev, [cardId]: false }));
    }
  }

  // reserved for future manual refresh

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="font-medium">Deck name</label>
        <input aria-label="Deck name" className="border rounded px-3 py-2 bg-transparent" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Untitled Deck" />
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Theme</label>
        <input aria-label="Theme" className="border rounded px-3 py-2 bg-transparent" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Star Wars, LOTR, Spongebob..." />
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Thematic ideas (optional)</label>
        <textarea
          aria-label="Deck-level thematic ideas"
          className="border rounded px-3 py-2 min-h-[120px] bg-transparent"
          value={deckIdea}
          onChange={(e) => setDeckIdea(e.target.value)}
          placeholder={`land sacrifice - extraction of resources\nSaga's are adventures undergone by our heroes\nDraw / discard : dancing`}
        />
        <p className="text-sm opacity-80">Deck-level guidance applied across the batch to improve cohesion.</p>
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Deck list (plaintext)</label>
                  <textarea aria-label="Deck list input" className="border rounded px-3 py-2 min-h-[220px] bg-transparent" value={deckText} onChange={(e) => setDeckText(e.target.value)} placeholder={`Commander: Szarel, Genesis Sheperd ; Palpatine\nScute Swarm\nWalk-In Closet // Forgotten Cellar\nThe Kami War\n1 Three Blind Mice\nBeast Within`}></textarea>
        <p className="text-sm opacity-80">Supports quantities. For inline notes use &quot; ; &quot; (semicolon). Example: &quot;Kenrith ; make him Palpatine&quot;. Commander line optional. No deck size cap.</p>
      </div>
      <div className="flex gap-3">
        <button aria-label="Generate proxies" disabled={loading} onClick={handleGenerate} className="px-4 py-2 rounded bg-black text-white dark:bg-white dark:text-black disabled:opacity-60">
          {loading ? "Generating..." : "Generate Proxies"}
        </button>
        {deckId && (
          <div className="flex gap-2">
            <a aria-label="View JSON" href={`/api/decks/${deckId}`} className="px-4 py-2 rounded border">View JSON</a>
            <a aria-label="Export CSV" href={`/api/decks/${deckId}/export?format=csv`} className="px-4 py-2 rounded border">Export CSV</a>
            <a aria-label="Export JSON" href={`/api/decks/${deckId}/export?format=json`} className="px-4 py-2 rounded border">Export JSON</a>
          </div>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}

      {deck && (
        <div className="mt-6 grid gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm opacity-80">Sort by:</span>
            <select aria-label="Sort cards" className="border rounded px-2 py-1 bg-transparent" value={sortBy} onChange={(e) => setSortBy(e.target.value as "type" | "cmc") }>
              <option value="type">Type</option>
              <option value="cmc">Mana Value</option>
              <option value="name">Name</option>
              <option value="nickname">Nickname</option>
            </select>
            <button
              className={`px-3 py-1 border rounded text-sm ${detailedView ? 'bg-blue-600 text-white' : 'bg-transparent'}`}
              aria-pressed={detailedView}
              aria-label="Toggle detailed view"
              onClick={() => setDetailedView(!detailedView)}
            >
              {detailedView ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          <DeckList
            deck={deck}
            sortBy={sortBy}
            detailedView={detailedView}
            selectedVersionByCard={selectedVersionByCard}
            setSelectedVersionByCard={setSelectedVersionByCard}
            loadingByCard={loadingByCard}
            reroll={reroll}
          />
        </div>
      )}
    </div>
  );
}
