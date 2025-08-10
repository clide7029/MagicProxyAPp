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
  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "json";
  const deck = await prisma.deck.findUnique({
    where: { id: params.id },
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
    ];
    const rows = deck.cards.map((c) => {
      const latest = c.proxyIdeas[0];
      return [
        c.originalName,
        latest?.thematicName || "",
        c.manaCost,
        c.typeLine,
        c.rulesText,
        latest?.thematicFlavorText || "",
        latest?.mediaReference || "",
        latest?.midjourneyPrompt || "",
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

  return NextResponse.json(deck);
}


