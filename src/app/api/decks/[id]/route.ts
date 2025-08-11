/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchScryfallCollection, type ScryfallIdentifier } from "@/lib/scryfall";

const prisma = new PrismaClient();

export async function GET(_: Request, { params }: any) {
  const { id } = await params;
  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      cards: {
        include: {
          proxyIdeas: {
            orderBy: { version: "desc" },
          },
        },
      },
    },
  });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Enrich with power/toughness from Scryfall
  const scryfallIds = Array.from(new Set(deck.cards.map((c: any) => c.scryfallId).filter(Boolean)));
  let scryById: Record<string, any> = {};
  try {
    if (scryfallIds.length > 0) {
      const identifiers: ScryfallIdentifier[] = scryfallIds.map((id: string) => ({ id }));
      const coll = await fetchScryfallCollection(identifiers);
      scryById = Object.fromEntries(coll.data.map((c) => [c.id, c]));
    }
  } catch {
    // ignore enrichment failures
  }

  // Transform the data to match our frontend types
  const transformedDeck = {
    ...deck,
    cards: deck.cards.map((card: any) => ({
      ...card,
      isDoubleFaced: card.isDoubleFaced,
      cardFaces: (() => {
        const parsed = card.cardFaces ? JSON.parse(card.cardFaces) : undefined;
        // enrich DFC faces with P/T if missing
        const scry = scryById[card.scryfallId];
        if (parsed && scry && Array.isArray(scry.card_faces)) {
          return parsed.map((f: any, i: number) => ({
            ...f,
            powerToughness: f.powerToughness || (scry.card_faces?.[i]?.power && scry.card_faces?.[i]?.toughness ? `${scry.card_faces[i].power}/${scry.card_faces[i].toughness}` : undefined),
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
      }))
    }))
  };

  return NextResponse.json(transformedDeck);
}


