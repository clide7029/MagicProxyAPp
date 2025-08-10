/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(_: Request, { params }: any) {
  const deck = await prisma.deck.findUnique({
    where: { id: params.id },
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

  return NextResponse.json(deck);
}


