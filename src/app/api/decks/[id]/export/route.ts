/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { enrichAndTransformDeck } from "@/lib/transform";

// Prisma singleton imported above

export const runtime = "nodejs";

function sanitizeForCsvCell(c: string) {
  const dangerous = /^[=+\-@]/;
  const normalized = c.replace(/\r/g, "").replace(/\n/g, " ");
  return dangerous.test(normalized) ? `'${normalized}` : normalized;
}

function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const cell = sanitizeForCsvCell(String(c ?? ""));
          return cell.includes(",") || cell.includes("\n") || cell.includes('"')
            ? `"${cell.replace(/"/g, '""')}"`
            : cell;
        })
        .join(",")
    )
    .join("\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
      "Produces Tokens",
      "Part Type",
      "Part Index",
      "Part Thematic Name",
      "Part Flavor",
      "Part Reference",
      "Part Prompt",
      "Part TypeLine",
      "Part P/T",
      "Part Token Rules",
      "Part Token Color",
    ];
    const transformed = await enrichAndTransformDeck(deck);
    const rows: string[][] = [];
    for (const c of transformed.cards as any[]) {
      const latest = c.proxyIdeas[0] || {};
      const base = [
        c.originalName,
        latest.thematicName || "",
        c.manaCost,
        c.typeLine,
        c.rulesText,
        latest.thematicFlavorText || "",
        latest.mediaReference || "",
        latest.midjourneyPrompt || "",
        c.isDoubleFaced ? "Yes" : "No",
        c.producesTokens ? "Yes" : "No",
      ];
      const cardFaces = Array.isArray(latest.cardFaces) ? latest.cardFaces : [];
      const tokens = Array.isArray(latest.tokens) ? latest.tokens : [];
      if (cardFaces.length === 0 && tokens.length === 0) {
        rows.push([...base, "", "", "", "", "", "", "", "", ""]);
        continue;
      }
      let faceIndex = 0;
      for (const face of cardFaces) {
        rows.push([
          ...base,
          "DFC Face",
          String(faceIndex + 1),
          face.thematic_name || face.thematicName || "",
          face.thematic_flavor_text || face.thematicFlavorText || "",
          face.media_reference || face.mediaReference || "",
          face.midjourney_prompt || face.midjourneyPrompt || "",
          c.cardFaces?.[faceIndex]?.typeLine || "",
          c.cardFaces?.[faceIndex]?.powerToughness || "",
          "",
          "",
        ]);
        faceIndex++;
      }
      let tokenIndex = 0;
      for (const token of tokens) {
        const tt = c.tokenTypes?.[tokenIndex];
        rows.push([
          ...base,
          "Token",
          String(tokenIndex + 1),
          token.thematic_name || token.thematicName || "",
          token.thematic_flavor_text || token.thematicFlavorText || "",
          token.media_reference || token.mediaReference || "",
          token.midjourney_prompt || token.midjourneyPrompt || "",
          tt?.typeLine || "",
          tt?.powerToughness || "",
          tt?.rulesText || "",
          tt?.colorIdentity || "",
        ]);
        tokenIndex++;
      }
    }
    const csv = toCsv([header, ...rows]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${deck.name.replace(/\W+/g, "-")}.csv`,
      },
    });
  }

  if (format === "json") {
    const transformedDeck = await enrichAndTransformDeck(deck);
    return new NextResponse(JSON.stringify(transformedDeck, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename=${deck.name.replace(/\W+/g, "-")}.json`,
      },
    });
  }

  return NextResponse.json(deck);
}


