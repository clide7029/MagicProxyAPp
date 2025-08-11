/* eslint-disable @typescript-eslint/no-explicit-any */
import { type ScryfallIdentifier } from "@/lib/scryfall";
import { fetchCardsWithDbCache } from "@/lib/scryfall-cache";

export async function enrichAndTransformDeck(deck: any) {
  // Enrich with power/toughness from Scryfall
  const scryfallIds = Array.from(new Set((deck.cards as any[]).map((c: any) => c.scryfallId as string).filter((v: unknown): v is string => typeof v === "string" && v.length > 0)));
  let scryById: Record<string, any> = {};
  try {
    if (scryfallIds.length > 0) {
      const identifiers: ScryfallIdentifier[] = scryfallIds.map((id: string) => ({ id }));
      const cards = await fetchCardsWithDbCache(identifiers);
      scryById = Object.fromEntries(cards.map((c) => [c.id, c]));
    }
  } catch {
    // ignore enrichment failures
  }

  const transformedDeck = {
    ...deck,
    cards: deck.cards.map((card: any) => ({
      ...card,
      isDoubleFaced: card.isDoubleFaced,
      cardFaces: (() => {
        const parsed = card.cardFaces ? JSON.parse(card.cardFaces) : undefined;
        const scry = scryById[card.scryfallId];
        if (parsed && scry && Array.isArray(scry.card_faces)) {
          return parsed.map((f: any, i: number) => ({
            ...f,
            powerToughness:
              f.powerToughness ||
              (scry.card_faces?.[i]?.power && scry.card_faces?.[i]?.toughness
                ? `${scry.card_faces[i].power}/${scry.card_faces[i].toughness}`
                : undefined),
          }));
        }
        return parsed;
      })(),
      producesTokens: card.producesTokens,
      tokenTypes: card.tokenTypes ? JSON.parse(card.tokenTypes) : undefined,
      powerToughness: (() => {
        const scry = scryById[card.scryfallId];
        if (!card.isDoubleFaced && scry && scry.power && scry.toughness) {
          return `${scry.power}/${scry.toughness}`;
        }
        return undefined;
      })(),
      proxyIdeas: card.proxyIdeas.map((idea: any) => ({
        ...idea,
        cardFaces: idea.cardFaces ? JSON.parse(idea.cardFaces) : undefined,
        tokens: idea.tokens ? JSON.parse(idea.tokens) : undefined,
      })),
    })),
  };

  return transformedDeck;
}


