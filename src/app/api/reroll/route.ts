import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { callOpenRouterBatch, type LlmCardInput } from "@/lib/openrouter";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { deckCardId, theme, userNote } = body as {
      deckCardId: string;
      theme: string;
      userNote?: string;
    };
    const card = await prisma.deckCard.findUnique({ where: { id: deckCardId } });
    if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const input: LlmCardInput = {
      original_name: card.originalName,
      type_line: card.typeLine,
      mana_cost: card.manaCost,
      rules_text: card.rulesText,
      is_legendary: /Legendary/.test(card.typeLine),
      is_commander: card.isCommander,
      color_identity: card.colorIdentity.split("").filter(Boolean),
      user_note: userNote,
    };
    const llm = await callOpenRouterBatch(theme, [input]);
    const out = llm.cards[0];

    const latest = await prisma.proxyIdea.findFirst({
      where: { deckCardId: card.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version || 0) + 1;
    const saved = await prisma.proxyIdea.create({
      data: {
        deckCardId: card.id,
        version: nextVersion,
        thematicName: out.thematic_name,
        thematicFlavorText: out.thematic_flavor_text,
        mediaReference: out.media_reference,
        artConcept: "",
        midjourneyPrompt: out.midjourney_prompt,
        modelUsed: process.env.OPENROUTER_MODEL || "openai/gpt-5-mini",
      },
    });

    return NextResponse.json(saved);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


