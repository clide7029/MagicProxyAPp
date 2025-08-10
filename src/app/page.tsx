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
    cmc: number;
    isCommander: boolean;
    proxyIdeas: Array<{
      thematicName: string;
      thematicFlavorText: string;
      mediaReference: string;
      midjourneyPrompt: string;
      version: number;
    }>;
  }>;
};

export default function Home() {
  const [theme, setTheme] = useState("Star Wars Empire");
  const [deckName, setDeckName] = useState("Empirial Expansion");
  const [deckText, setDeckText] = useState(`Commander: Szarel, Genesis Sheperd // Palpatine
Crystalline Crawler
Braids, Arisen Nightmare
Eumidian Wastewaker
Evendo Brushrazer
Bristly Bill, Spine Sower`);
  const [deckIdea, setDeckIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [deck, setDeck] = useState<DeckResponse | null>(null);
  const [sortBy, setSortBy] = useState<"type" | "cmc" | "name" | "nickname">("type");
  const [selectedVersionByCard, setSelectedVersionByCard] = useState<Record<string, number>>({});

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
        <p className="text-sm opacity-80">Legendary names must follow NAME, ROLE. Prefer comics/illustration sources; include artist credit in reference.</p>
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
        <textarea className="border rounded px-3 py-2 min-h-[220px] bg-transparent" value={deckText} onChange={(e) => setDeckText(e.target.value)} placeholder={`Commander: Kenrith, the Returned King\n1 Sol Ring\n1 Swords to Plowshares // make token match card theme`}></textarea>
        <p className="text-sm opacity-80">Supports quantities and inline notes after // . Commander line optional. No deck size cap.</p>
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
                      <div className="text-sm opacity-80">{c.manaCost} • {c.typeLine}</div>
                      <div className="text-sm mt-1 whitespace-pre-wrap">{c.rulesText}</div>
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
                      <div><span className="font-medium">Thematic Name:</span> {current.thematicName}</div>
                      <div><span className="font-medium">Thematic Flavor Text:</span> {current.thematicFlavorText}</div>
                      <div><span className="font-medium">Media Reference:</span> {current.mediaReference}</div>
                      <div className="break-all"><span className="font-medium">Midjourney Prompt:</span> {current.midjourneyPrompt}</div>
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
