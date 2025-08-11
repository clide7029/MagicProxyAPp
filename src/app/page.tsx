"use client";
import { useEffect, useMemo, useState } from "react";
import { parseDeckText } from "@/lib/deck-parse";

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
  const [deckName, setDeckName] = useState("Empirial Expansion");
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
    (async () => {
      try {
        const resp = await fetch(`/api/decks/${deckId}`);
        const data = (await resp.json()) as DeckResponse;
        setDeck(data);
      } catch {
        // ignore
      }
    })();
  }, [deckId]);

  const sortedCards = useMemo(() => {
    if (!deck) return [] as DeckResponse["cards"];
    const arr = [...deck.cards];
    const getCurrentIdea = (c: DeckResponse["cards"][number]) => {
      const sel = selectedVersionByCard[c.id];
      return c.proxyIdeas.find((p) => p.version === sel) || c.proxyIdeas[0];
    };
    if (sortBy === "type") {
      arr.sort((a, b) => a.typeLine.localeCompare(b.typeLine) || a.originalName.localeCompare(b.originalName));
    } else if (sortBy === "cmc") {
      arr.sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.originalName.localeCompare(b.originalName));
    } else if (sortBy === "name") {
      arr.sort((a, b) => a.originalName.localeCompare(b.originalName));
    } else if (sortBy === "nickname") {
      arr.sort((a, b) => {
        const an = (getCurrentIdea(a)?.thematicName || "").toLowerCase();
        const bn = (getCurrentIdea(b)?.thematicName || "").toLowerCase();
        if (an === bn) return a.originalName.localeCompare(b.originalName);
        return an < bn ? -1 : 1;
      });
    }
    return arr;
  }, [deck, sortBy, selectedVersionByCard]);

  async function reroll(cardId: string) {
    if (!deck) return;
    try {
      setLoading(true);
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
      // surface minimal error
      setError(e instanceof Error ? e.message : "Reroll failed");
    } finally {
      setLoading(false);
    }
  }

  // reserved for future manual refresh

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="font-medium">Deck name</label>
        <input className="border rounded px-3 py-2 bg-transparent" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Untitled Deck" />
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Theme</label>
        <input className="border rounded px-3 py-2 bg-transparent" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Star Wars, LOTR, Spongebob..." />
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Thematic ideas (optional)</label>
        <textarea
          className="border rounded px-3 py-2 min-h-[120px] bg-transparent"
          value={deckIdea}
          onChange={(e) => setDeckIdea(e.target.value)}
          placeholder={`land sacrifice - extraction of resources\nSaga's are adventures undergone by our heroes\nDraw / discard : dancing`}
        />
        <p className="text-sm opacity-80">Deck-level guidance applied across the batch to improve cohesion.</p>
      </div>
      <div className="grid gap-3">
        <label className="font-medium">Deck list (plaintext)</label>
                  <textarea className="border rounded px-3 py-2 min-h-[220px] bg-transparent" value={deckText} onChange={(e) => setDeckText(e.target.value)} placeholder={`Commander: Szarel, Genesis Sheperd ; Palpatine\nScute Swarm\nWalk-In Closet // Forgotten Cellar\nThe Kami War\n1 Three Blind Mice\nBeast Within`}></textarea>
        <p className="text-sm opacity-80">Supports quantities. For inline notes use &quot; ; &quot; (semicolon). Example: &quot;Kenrith ; make him Palpatine&quot;. Commander line optional. No deck size cap.</p>
      </div>
      <div className="flex gap-3">
        <button disabled={loading} onClick={handleGenerate} className="px-4 py-2 rounded bg-black text-white dark:bg-white dark:text-black disabled:opacity-60">
          {loading ? "Generating..." : "Generate Proxies"}
        </button>
        {deckId && (
          <div className="flex gap-2">
            <a href={`/api/decks/${deckId}`} className="px-4 py-2 rounded border">View JSON</a>
            <a href={`/api/decks/${deckId}/export?format=csv`} className="px-4 py-2 rounded border">Export CSV</a>
            <a href={`/api/decks/${deckId}`} className="px-4 py-2 rounded border">Export JSON</a>
          </div>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}

      {deck && (
        <div className="mt-6 grid gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm opacity-80">Sort by:</span>
            <select className="border rounded px-2 py-1 bg-transparent" value={sortBy} onChange={(e) => setSortBy(e.target.value as "type" | "cmc")}>
              <option value="type">Type</option>
              <option value="cmc">Mana Value</option>
              <option value="name">Name</option>
              <option value="nickname">Nickname</option>
            </select>
            <button
              className={`px-3 py-1 border rounded text-sm ${detailedView ? 'bg-blue-600 text-white' : 'bg-transparent'}`}
              onClick={() => setDetailedView(!detailedView)}
            >
              {detailedView ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          <div className="grid gap-3">
            {sortedCards.map((c) => {
              const chosenVersion = selectedVersionByCard[c.id];
              const current = c.proxyIdeas.find((p) => p.version === chosenVersion) || c.proxyIdeas[0];
              return (
                <div key={c.id} className="border rounded p-3">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="font-semibold">
                        {c.originalName}
                        {current ? ` → ${current.thematicName}` : ""}
                        {c.isCommander ? " (Commander)" : ""}
                      </div>
                      {!c.isDoubleFaced && (
                        <>
                          <div className="text-sm opacity-80">
                            {(() => {
                              const mc = c.manaCost || "";
                              if (mc && mc.length > 0) {
                                return <><span>{mc}</span> <span>•</span> </>;
                              }
                              const cid = c.colorIdentity;
                              if (cid && cid.length > 0) {
                                const formatted = cid.split("").map((ch) => `{${ch}}`).join("");
                                return <><span className="font-mono text-blue-600 dark:text-blue-400">{formatted}</span> <span>•</span> </>;
                              }
                              return null;
                            })()}
                            {c.typeLine}
                            {(() => {
                              // compute P/T for single-faced cards from faces array if present, else from top-level
                              const pt = !c.isDoubleFaced
                                ? (c.cardFaces && c.cardFaces[0]?.powerToughness) || c.powerToughness
                                : undefined;
                              return pt ? (
                                <span> • <span className="font-mono">{pt}</span></span>
                              ) : null;
                            })()}
                          </div>
                          <div className="text-sm mt-1 whitespace-pre-wrap">{c.rulesText}</div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="border rounded px-2 py-1 bg-transparent"
                        value={chosenVersion ?? (c.proxyIdeas[0]?.version ?? 1)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          setSelectedVersionByCard((prev) => ({ ...prev, [c.id]: v }));
                        }}
                      >
                        {c.proxyIdeas.map((p) => (
                          <option key={p.version} value={p.version}>v{p.version}</option>
                        ))}
                      </select>
                      <button className="px-3 py-1 border rounded" onClick={() => reroll(c.id)} disabled={loading}>Reroll</button>
                    </div>
                  </div>
                  {current && (
                    <div className="mt-3 grid gap-1 text-sm">
                      <div><span className="font-medium">Flavor Text:</span> {current.thematicFlavorText}</div>
                      <div><span className="font-medium">Art Concept:</span> {current.mediaReference}</div>
                      <div className="break-all"><span className="font-medium">Midjourney Prompt:</span> {current.midjourneyPrompt}</div>
                      
                      {/* DFC Faces */}
                      {detailedView && c.isDoubleFaced && current.cardFaces && current.cardFaces.length > 0 && (
                        <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                          <div className="text-xs font-medium mb-2 text-gray-600 dark:text-gray-400">Double-Faced Card Proxies:</div>
                          {current.cardFaces.map((face, index) => (
                            <div key={index} className={`${index > 0 ? 'border-t pt-2 mt-2' : ''}`}>
                              <div className="font-medium text-xs">{face.thematicName || face.thematic_name || `Face ${index + 1}`}</div>
                              <div className="text-xs opacity-80 mb-2">
                                {(() => {
                                  const mc = c.cardFaces?.[index]?.manaCost || "";
                                  if (mc && mc.length > 0) {
                                    return <><span>{mc}</span> <span>•</span> </>;
                                  }
                                  const cid = c.colorIdentity;
                                  if (cid && cid.length > 0) {
                                    const formatted = cid.split("").map((ch) => `{${ch}}`).join("");
                                    return <><span className="font-mono text-white-600 dark:text-white-400">{formatted}</span> <span>•</span> </>;
                                  }
                                  return null;
                                })()}
                                {c.cardFaces?.[index]?.typeLine}
                                {c.cardFaces?.[index]?.powerToughness && (
                                  <span> • <span className="font-mono">{c.cardFaces[index].powerToughness}</span></span>
                                )}
                              </div>
                              <div className="text-xs mb-2 whitespace-pre-wrap">{c.cardFaces?.[index]?.rulesText}</div>
                              <div><span className="font-medium text-xs">Flavor Text:</span> {face.thematicFlavorText || face.thematic_flavor_text}</div>
                              <div><span className="font-medium text-xs">Art Concept:</span> {face.mediaReference || face.media_reference}</div>
                              <div className="break-all"><span className="font-medium text-xs">Midjourney Prompt:</span> {face.midjourneyPrompt || face.midjourney_prompt}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Tokens */}
                      {detailedView && c.producesTokens && c.tokenTypes && c.tokenTypes.length > 0 && (
                        <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                          <div className="text-xs font-medium mb-2 text-white-600 dark:text-white-400">Token Proxies:</div>
                          {current.tokens && current.tokens.length > 0 ? (
                            (() => {
                              const aligned = orderTokenTypesToIdeas(current.tokens!, c.tokenTypes || []);
                              return current.tokens!.map((token, index) => {
                                const tt = aligned[index] || c.tokenTypes?.[index];
                                return (
                              <div key={index} className={`${index > 0 ? 'border-t pt-2 mt-2' : ''}`}>
                                <div className="font-medium text-xs">{token.thematicName || token.thematic_name || tt?.name || `Token ${index + 1}`}</div>
                                {tt?.typeLine && (
                                  <div className="text-xs opacity-80 mb-1">
                                    {tt?.colorIdentity && (<span className="font-medium text-xs">{tt.colorIdentity} • </span>)}
                                    {tt.typeLine} 
                                    {tt?.powerToughness && (<span className="font-medium text-xs"> • {tt.powerToughness}</span>)}
                                  </div>
                                )}
                                {tt?.rulesText && (
                                  <div className="text-xs opacity-90 mb-1">
                                    <span className="font-medium text-xs">Rules: </span>
                                    <span className="font-medium text-xs">{tt.rulesText}</span>
                                  </div>
                                )}
                                <div><span className="font-medium text-xs">Flavor:</span> {token.thematicFlavorText || token.thematic_flavor_text}</div>
                                <div><span className="font-medium text-xs">Reference:</span> {token.mediaReference || token.media_reference}</div>
                                <div className="break-all"><span className="font-medium text-xs">Prompt:</span> {token.midjourneyPrompt || token.midjourney_prompt}</div>
                              </div>
                                );
                              });
                            })()
                          ) : (
                            <div className="text-xs opacity-80 italic">
                              No token proxies generated yet
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
