"use client";
import { useMemo } from "react";

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
      cardFaces?: Array<{
        thematicName?: string;
        thematicFlavorText?: string;
        mediaReference?: string;
        midjourneyPrompt?: string;
        thematic_name?: string;
        thematic_flavor_text?: string;
        media_reference?: string;
        midjourney_prompt?: string;
      }>;
      tokens?: Array<{
        thematicName?: string;
        thematicFlavorText?: string;
        mediaReference?: string;
        midjourneyPrompt?: string;
        thematic_name?: string;
        thematic_flavor_text?: string;
        media_reference?: string;
        midjourney_prompt?: string;
      }>;
    }>;
  }>;
};

type Props = {
  deck: DeckResponse;
  sortBy: "type" | "cmc" | "name" | "nickname";
  detailedView: boolean;
  selectedVersionByCard: Record<string, number>;
  setSelectedVersionByCard: (fn: (prev: Record<string, number>) => Record<string, number>) => void;
  loadingByCard: Record<string, boolean>;
  reroll: (cardId: string) => Promise<void>;
};

// Helpers to align generated token writeups to actual token types
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

function extractSubtypeWordsFromTypeLine(typeLine: string): string[] {
  const afterDash = typeLine.split("—")[1]?.trim().toLowerCase() || "";
  if (!afterDash) return [];
  const words = afterDash.split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (afterDash && !words.includes(afterDash)) {
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
  if (tokenType.powerToughness && haystack.includes(tokenType.powerToughness)) score += 1;
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

export default function DeckList({ deck, sortBy, detailedView, selectedVersionByCard, setSelectedVersionByCard, loadingByCard, reroll }: Props) {
  const sortedCards = useMemo(() => {
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

  return (
    <div className="grid gap-3" aria-live="polite">
      {sortedCards.map((c) => {
        const chosenVersion = selectedVersionByCard[c.id];
        const current = c.proxyIdeas.find((p) => p.version === chosenVersion) || c.proxyIdeas[0];
        return (
          <div key={c.id} className="border rounded p-3" role="group" aria-label={`Card ${c.originalName}`}>
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
                <label className="sr-only" htmlFor={`version-${c.id}`}>Select version</label>
                <select
                  id={`version-${c.id}`}
                  className="border rounded px-2 py-1 bg-transparent"
                  aria-label={`Select version for ${c.originalName}`}
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
                <button
                  className="px-3 py-1 border rounded"
                  onClick={() => reroll(c.id)}
                  aria-label={`Reroll proxy idea for ${c.originalName}`}
                  disabled={!!loadingByCard[c.id]}
                >
                  {loadingByCard[c.id] ? 'Rerolling...' : 'Reroll'}
                </button>
              </div>
            </div>
            {current && (
              <div className="mt-3 grid gap-1 text-sm">
                <div><span className="font-medium">Flavor Text:</span> {current.thematicFlavorText}</div>
                <div><span className="font-medium">Art Concept:</span> {current.mediaReference}</div>
                <div className="break-all"><span className="font-medium">Midjourney Prompt:</span> {current.midjourneyPrompt}</div>

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
                              return <><span className="font-mono text-blue-600 dark:text-blue-400">{formatted}</span> <span>•</span> </>;
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

                {detailedView && c.producesTokens && c.tokenTypes && c.tokenTypes.length > 0 && (
                  <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                    <div className="text-xs font-medium mb-2 text-gray-600 dark:text-gray-300">Token Proxies:</div>
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
  );
}


