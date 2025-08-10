-- CreateTable
CREATE TABLE "Deck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeckCard" (
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
    "oracleId" TEXT NOT NULL,
    "scryfallId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckCard_parentDeckCardId_fkey" FOREIGN KEY ("parentDeckCardId") REFERENCES "DeckCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProxyIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "thematicName" TEXT NOT NULL,
    "thematicFlavorText" TEXT NOT NULL,
    "mediaReference" TEXT NOT NULL,
    "artConcept" TEXT NOT NULL,
    "midjourneyPrompt" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "tokenStats" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProxyIdea_deckCardId_fkey" FOREIGN KEY ("deckCardId") REFERENCES "DeckCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CacheCard" (
    "oracleId" TEXT NOT NULL PRIMARY KEY,
    "jsonBlob" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DeckCard_deckId_idx" ON "DeckCard"("deckId");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyIdea_deckCardId_version_key" ON "ProxyIdea"("deckCardId", "version");
