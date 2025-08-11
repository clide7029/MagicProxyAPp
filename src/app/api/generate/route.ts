import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fetchScryfallCollection, extractPrimaryText, getGeneratedTokenHints, type ScryfallIdentifier, fetchScryfallNamedFuzzy } from "@/lib/scryfall";
import { callOpenRouterBatch, type LlmCardInput } from "@/lib/openrouter";
import { z } from "zod";
import { rateLimitAllow } from "@/app/api/_rateLimit";
import type { LlmCardOutput } from "@/lib/openrouter";

export const runtime = "nodejs";

const LineSchema = z.object({
  quantity: z.number().int().min(1).max(99),
  name: z.string().min(1),
  note: z.string().optional(),
  is_commander: z.boolean(),
});

const BodySchema = z.object({
  deckName: z.string().default("Untitled Deck"),
  theme: z.string().min(2).max(100),
  deckIdea: z.string().max(2000).optional(),
  parsedLines: z.array(LineSchema).min(1).max(150),
});

// Prisma singleton imported above

export async function POST(req: Request) {
  try {
    if (!rateLimitAllow(req)) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
    const body = await req.json();
    const { deckName, theme, deckIdea, parsedLines } = BodySchema.parse(body);
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

    // Persist fetched cards into CacheCard for future runs
    try {
      await Promise.all(
        coll.data
          .filter((c) => !!c.oracle_id)
          .map((card) =>
            prisma.cacheCard.upsert({
              where: { oracleId: card.oracle_id },
              create: { oracleId: card.oracle_id, jsonBlob: card },
              update: { jsonBlob: card },
            })
          )
      );
    } catch {
      // ignore cache persistence errors
    }

    // Parallel fuzzy lookups for missing names after initial collection fetch
    const missingNames = uniqueNames.filter((name) => !idByName.has(name.toLowerCase()));
    const fuzzyResults = await Promise.all(
      missingNames.map(async (n) => ({ key: n.toLowerCase(), card: await fetchScryfallNamedFuzzy(n) }))
    );
    for (const fr of fuzzyResults) {
      if (fr.card) {
        idByName.set(fr.key, fr.card);
        // persist fuzzy resolves too
        try {
          if (fr.card.oracle_id) {
            await prisma.cacheCard.upsert({
              where: { oracleId: fr.card.oracle_id },
              create: { oracleId: fr.card.oracle_id, jsonBlob: fr.card },
              update: { jsonBlob: fr.card },
            });
          }
        } catch {
          // ignore
        }
      }
    }

    // Create DeckCards and prepare LLM batch inputs
    const llmInputs: LlmCardInput[] = [];
    const deckCards = [] as Array<{ id: string; name: string; oracle_id: string; scryfall_id: string; is_commander: boolean; type_line: string; mana_cost: string; rules_text: string; color_identity: string[] }>;

    for (const line of parsedLines) {
      const c = idByName.get(line.name.toLowerCase());
      if (!c) {
        notFound.push(line.name);
        continue;
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

    // Batch LLM calls with chunking to avoid token limits
    const chunkSize = 30;
    const concurrency = 2;
    const allOutputs: LlmCardOutput[] = [];
    for (let i = 0; i < llmInputs.length; i += chunkSize * concurrency) {
      const groups = Array.from({ length: concurrency }, (_, k) => llmInputs.slice(i + k * chunkSize, i + (k + 1) * chunkSize)).filter((g) => g.length);
      const results = await Promise.all(groups.map((g) => callOpenRouterBatch(theme, g, deckIdea)));
      for (const r of results) allOutputs.push(...r.cards);
    }

    // Save ProxyIdeas
    const version = 1;
    for (const out of allOutputs) {
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
    // Rebuild not_found after fuzzy pass only
    const stillMissing = uniqueNames.filter((n) => !idByName.has(n.toLowerCase()));
    return NextResponse.json({ deckId: deck.id, not_found: stillMissing });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


