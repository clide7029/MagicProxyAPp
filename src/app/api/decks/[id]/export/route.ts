/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (c.includes(",") || c.includes("\n") ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export async function GET(req: Request, { params }: any) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "json";
  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      cards: {
        include: {
          proxyIdeas: { orderBy: { version: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (format === "csv") {
    const header = [
      "Original Name",
      "Thematic Name",
      "Mana Cost",
      "Type",
      "Rules Text",
      "Thematic Flavor Text",
      "Media Reference (artist credit)",
      "Midjourney Prompt",
      "Is Double-Faced",
      "DFC Face 1 Name",
      "DFC Face 1 Flavor",
      "DFC Face 1 Reference",
      "DFC Face 1 Prompt",
      "DFC Face 2 Name",
      "DFC Face 2 Flavor",
      "DFC Face 2 Reference",
      "DFC Face 2 Prompt",
      "Produces Tokens",
      "Token 1 Name",
      "Token 1 Flavor",
      "Token 1 Reference",
      "Token 1 Prompt",
      "Token 2 Name",
      "Token 2 Flavor",
      "Token 2 Reference",
      "Token 2 Prompt",
    ];
    const rows = deck.cards.map((c: any) => {
      const latest = c.proxyIdeas[0];
      const cardFaces = latest?.cardFaces ? JSON.parse(latest.cardFaces) : [];
      const tokens = latest?.tokens ? JSON.parse(latest.tokens) : [];
      const isDoubleFaced = c.isDoubleFaced;
      const producesTokens = c.producesTokens;
      
      return [
        c.originalName,
        latest?.thematicName || "",
        c.manaCost,
        c.typeLine,
        c.rulesText,
        latest?.thematicFlavorText || "",
        latest?.mediaReference || "",
        latest?.midjourneyPrompt || "",
        isDoubleFaced ? "Yes" : "No",
        cardFaces[0]?.thematic_name || cardFaces[0]?.thematicName || "",
        cardFaces[0]?.thematic_flavor_text || cardFaces[0]?.thematicFlavorText || "",
        cardFaces[0]?.media_reference || cardFaces[0]?.mediaReference || "",
        cardFaces[0]?.midjourney_prompt || cardFaces[0]?.midjourneyPrompt || "",
        cardFaces[1]?.thematic_name || cardFaces[1]?.thematicName || "",
        cardFaces[1]?.thematic_flavor_text || cardFaces[1]?.thematicFlavorText || "",
        cardFaces[1]?.media_reference || cardFaces[1]?.mediaReference || "",
        cardFaces[1]?.midjourney_prompt || cardFaces[1]?.midjourneyPrompt || "",
        producesTokens ? "Yes" : "No",
        tokens[0]?.thematic_name || tokens[0]?.thematicName || "",
        tokens[0]?.thematic_flavor_text || tokens[0]?.thematicFlavorText || "",
        tokens[0]?.media_reference || tokens[0]?.mediaReference || "",
        tokens[0]?.midjourney_prompt || tokens[0]?.midjourneyPrompt || "",
        tokens[1]?.thematic_name || tokens[1]?.thematicName || "",
        tokens[1]?.thematic_flavor_text || tokens[1]?.thematicFlavorText || "",
        tokens[1]?.media_reference || tokens[1]?.mediaReference || "",
        tokens[1]?.midjourney_prompt || tokens[1]?.midjourneyPrompt || "",
      ];
    });
    const csv = toCsv([header, ...rows]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${deck.name.replace(/\W+/g, "-")}.csv`,
      },
    });
  }

  if (format === "json") {
    const transformedDeck = {
      ...deck,
      cards: deck.cards.map((c: any) => ({
        ...c,
        isDoubleFaced: c.isDoubleFaced,
        cardFaces: c.cardFaces ? JSON.parse(c.cardFaces) : undefined,
        producesTokens: c.producesTokens,
        tokenTypes: c.tokenTypes ? JSON.parse(c.tokenTypes) : undefined,
        proxyIdeas: c.proxyIdeas.map((idea: any) => ({
          ...idea,
          cardFaces: idea.cardFaces ? JSON.parse(idea.cardFaces) : undefined,
          tokens: idea.tokens ? JSON.parse(idea.tokens) : undefined,
        }))
      }))
    };
    
    return new NextResponse(JSON.stringify(transformedDeck, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename=${deck.name.replace(/\W+/g, "-")}.json`,
      },
    });
  }

  return NextResponse.json(deck);
}


