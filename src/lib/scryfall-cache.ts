import prisma from "@/lib/prisma";
import { fetchScryfallCollection, type ScryfallIdentifier, type ScryfallCard } from "@/lib/scryfall";

const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function keyForIdentifier(identifier: ScryfallIdentifier): string | null {
  if ("oracle_id" in identifier) return identifier.oracle_id;
  if ("id" in identifier) return identifier.id;
  return null;
}

export async function fetchCardsWithDbCache(identifiers: ScryfallIdentifier[]): Promise<ScryfallCard[]> {
  const keys = identifiers.map(keyForIdentifier).filter(Boolean) as string[];

  const now = Date.now();
  let freshByKey = new Map<string, ScryfallCard>();

  if (keys.length > 0) {
    const cached = await prisma.cacheCard.findMany({ where: { oracleId: { in: keys } } });
    const fresh = cached.filter((c) => now - new Date(c.updatedAt).getTime() < TTL_MS);
    freshByKey = new Map(fresh.map((c) => [c.oracleId, c.jsonBlob as unknown as ScryfallCard]));
  }

  const missing = identifiers.filter((id) => {
    const k = keyForIdentifier(id);
    if (!k) return true;
    return !freshByKey.has(k);
  });

  let fetched: ScryfallCard[] = [];
  if (missing.length > 0) {
    const res = await fetchScryfallCollection(missing);
    fetched = res.data;
    // Upsert by oracle_id only if present
    await Promise.all(
      fetched
        .filter((c) => !!c.oracle_id)
        .map((card) =>
          prisma.cacheCard.upsert({
            where: { oracleId: card.oracle_id },
            create: { oracleId: card.oracle_id, jsonBlob: card },
            update: { jsonBlob: card },
          })
        )
    );
  }

  // Merge fresh cache and fetched
  const out = new Map<string, ScryfallCard>();
  for (const c of fetched) {
    out.set(c.oracle_id || c.id, c);
  }
  for (const [k, c] of freshByKey.entries()) {
    if (!out.has(k)) out.set(k, c);
  }
  return Array.from(out.values());
}


