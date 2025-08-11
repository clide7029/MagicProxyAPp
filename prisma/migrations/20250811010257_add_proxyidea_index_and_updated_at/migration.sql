-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProxyIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "thematicName" TEXT NOT NULL,
    "thematicFlavorText" TEXT NOT NULL,
    "mediaReference" TEXT NOT NULL,
    "artConcept" TEXT NOT NULL,
    "midjourneyPrompt" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "cardFaces" TEXT,
    "tokens" TEXT,
    "tokenStats" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProxyIdea_deckCardId_fkey" FOREIGN KEY ("deckCardId") REFERENCES "DeckCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProxyIdea" ("artConcept", "cardFaces", "createdAt", "deckCardId", "id", "mediaReference", "midjourneyPrompt", "modelUsed", "thematicFlavorText", "thematicName", "tokenStats", "tokens", "version") SELECT "artConcept", "cardFaces", "createdAt", "deckCardId", "id", "mediaReference", "midjourneyPrompt", "modelUsed", "thematicFlavorText", "thematicName", "tokenStats", "tokens", "version" FROM "ProxyIdea";
DROP TABLE "ProxyIdea";
ALTER TABLE "new_ProxyIdea" RENAME TO "ProxyIdea";
CREATE INDEX "ProxyIdea_deckCardId_idx" ON "ProxyIdea"("deckCardId");
CREATE UNIQUE INDEX "ProxyIdea_deckCardId_version_key" ON "ProxyIdea"("deckCardId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
