-- AlterTable
ALTER TABLE "ProxyIdea" ADD COLUMN "cardFaces" TEXT;
ALTER TABLE "ProxyIdea" ADD COLUMN "tokens" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeckCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "parentDeckCardId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "inputLine" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "manaCost" TEXT NOT NULL DEFAULT '',
    "typeLine" TEXT NOT NULL DEFAULT '',
    "rulesText" TEXT NOT NULL DEFAULT '',
    "colorIdentity" TEXT NOT NULL DEFAULT '',
    "cmc" REAL NOT NULL DEFAULT 0,
    "isCommander" BOOLEAN NOT NULL DEFAULT false,
    "isToken" BOOLEAN NOT NULL DEFAULT false,
    "isDoubleFaced" BOOLEAN NOT NULL DEFAULT false,
    "cardFaces" TEXT,
    "producesTokens" BOOLEAN NOT NULL DEFAULT false,
    "tokenTypes" TEXT,
    "oracleId" TEXT NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckCard_parentDeckCardId_fkey" FOREIGN KEY ("parentDeckCardId") REFERENCES "DeckCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DeckCard" ("cmc", "colorIdentity", "createdAt", "deckId", "id", "inputLine", "isCommander", "isToken", "manaCost", "oracleId", "originalName", "parentDeckCardId", "quantity", "rulesText", "scryfallId", "typeLine") SELECT "cmc", "colorIdentity", "createdAt", "deckId", "id", "inputLine", "isCommander", "isToken", "manaCost", "oracleId", "originalName", "parentDeckCardId", "quantity", "rulesText", "scryfallId", "typeLine" FROM "DeckCard";
DROP TABLE "DeckCard";
ALTER TABLE "new_DeckCard" RENAME TO "DeckCard";
CREATE INDEX "DeckCard_deckId_idx" ON "DeckCard"("deckId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
