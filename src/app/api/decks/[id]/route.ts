 
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { enrichAndTransformDeck } from "@/lib/transform";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const transformedDeck = await enrichAndTransformDeck(deck);
  return NextResponse.json(transformedDeck);
}


