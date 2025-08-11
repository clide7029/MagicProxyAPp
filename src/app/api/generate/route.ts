import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { fetchScryfallCollection, extractPrimaryText, getGeneratedTokenHints, type ScryfallIdentifier, fetchScryfallNamedFuzzy } from "@/lib/scryfall";
import { callOpenRouterBatch, type LlmCardInput } from "@/lib/openrouter";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { deckName, theme, deckIdea, parsedLines } = body as {
      deckName: string;
      theme: string;
      deckIdea?: string;
      parsedLines: Array<{ quantity: number; name: string; note?: string; is_commander: boolean }>;
    };
    if (!theme || !parsedLines?.length) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const deck = await prisma.deck.create({ data: { name: deckName || "Untitled Deck", theme } });

    // Build Scryfall identifiers (dedupe names)
    const uniqueNames = Array.from(new Set(parsedLines.map((l) => l.name)));
    const identifiers: ScryfallIdentifier[] = uniqueNames.map((name) => ({ name }));
    const coll = await fetchScryfallCollection(identifiers);
    const idByName = new Map(coll.data.map((c) => [c.name.toLowerCase(), c]));
    const notFound: string[] = [];

    // Create DeckCards and prepare LLM batch inputs
    const llmInputs: LlmCardInput[] = [];
    const deckCards = [] as Array<{ id: string; name: string; oracle_id: string; scryfall_id: string; is_commander: boolean; type_line: string; mana_cost: string; rules_text: string; color_identity: string[] }>;

    for (const line of parsedLines) {
      let c = idByName.get(line.name.toLowerCase());
      if (!c) {
        // try fuzzy
        const fuzzy = await fetchScryfallNamedFuzzy(line.name);
        if (fuzzy) {
          c = fuzzy;
        } else {
          notFound.push(line.name);
          continue;
        }
      }
      const { rulesText, typeLine, manaCost, cmc, isDoubleFaced, /* powerToughness intentionally unused here */ cardFaces, producesTokens, tokenTypes } = extractPrimaryText(c);
      const created = await prisma.deckCard.create({
        data: {
          deckId: deck.id,
          quantity: line.quantity,
          inputLine: line.name,
          originalName: c.name,
          manaCost: manaCost,
          typeLine: typeLine,
          rulesText: rulesText,
          colorIdentity: (c.color_identity || []).join(""),
          cmc: cmc,
          isCommander: line.is_commander,
          isToken: false,
          oracleId: c.oracle_id,
          scryfallId: c.id,
          isDoubleFaced,
          cardFaces: cardFaces ? JSON.stringify(cardFaces) : null,
          producesTokens,
          tokenTypes: tokenTypes ? JSON.stringify(tokenTypes) : null,
        },
      });

      deckCards.push({
        id: created.id,
        name: c.name,
        oracle_id: c.oracle_id,
        scryfall_id: c.id,
        is_commander: line.is_commander,
        type_line: typeLine,
        mana_cost: manaCost,
        rules_text: rulesText,
        color_identity: c.color_identity || [],
      });

      const tokens = getGeneratedTokenHints(c);
      llmInputs.push({
        original_name: c.name,
        type_line: typeLine,
        mana_cost: manaCost,
        rules_text: rulesText,
        is_legendary: /Legendary/.test(typeLine),
        is_commander: line.is_commander,
        color_identity: c.color_identity || [],
        token_hints: tokens,
        user_note: line.note,
        is_double_faced: isDoubleFaced,
        card_faces: cardFaces,
        produces_tokens: producesTokens,
        token_types: tokenTypes,
      });
    }

    // Batch LLM calls (simple single batch for now; later chunk by size)
    const llm = await callOpenRouterBatch(theme, llmInputs, deckIdea);

    // Save ProxyIdeas
    const version = 1;
    for (const out of llm.cards) {
      const dc = deckCards.find((d) => d.name === out.original_name);
      if (!dc) continue;
      await prisma.proxyIdea.create({
        data: {
          deckCardId: dc.id,
          version: version,
          thematicName: out.thematic_name,
          thematicFlavorText: out.thematic_flavor_text,
          mediaReference: out.media_reference,
          artConcept: "", // kept for future; not exposed per v1 fields
          midjourneyPrompt: out.midjourney_prompt,
          cardFaces: out.card_faces ? JSON.stringify(out.card_faces) : null,
          tokens: out.tokens ? JSON.stringify(out.tokens) : null,
          modelUsed: process.env.OPENROUTER_MODEL || "openai/gpt-5-mini",
        },
      });
    }

    // Return data for display, plus not_found cards
    return NextResponse.json({ deckId: deck.id, not_found: notFound });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


