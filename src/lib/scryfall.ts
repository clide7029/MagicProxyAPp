export type ScryfallIdentifier =
  | { name: string }
  | { id: string }
  | { oracle_id: string }
  | { set: string; collector_number: string };

export type ScryfallCard = {
  id: string;
  oracle_id: string;
  name: string;
  type_line: string;
  power?: string;
  toughness?: string;
  mana_cost?: string;
  cmc?: number;
  color_identity?: string[];
  oracle_text?: string;
  all_parts?: Array<{ id: string; component: string; name: string; type_line: string; oracle_text?: string }>;
  card_faces?: Array<{
    name: string;
    type_line: string;
    mana_cost?: string;
    power?: string;
    toughness?: string;
    oracle_text?: string;
  }>;
};

export type ScryfallCollectionResponse = {
  data: ScryfallCard[];
  not_found?: Array<Record<string, string>>;
};

function scryfallHeaders(): Record<string, string> {
  return {
    "User-Agent": "clide-personal-mtgfetchapp",
    Accept: "*/*",
    "Content-Type": "application/json",
  };
}

export async function fetchScryfallCollection(identifiers: ScryfallIdentifier[]): Promise<ScryfallCollectionResponse> {
  const resp = await fetch("https://api.scryfall.com/cards/collection", {
    method: "POST",
    headers: scryfallHeaders(),
    body: JSON.stringify({ identifiers }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Scryfall error ${resp.status}: ${text}`);
  }
  return (await resp.json()) as ScryfallCollectionResponse;
}

export function extractPrimaryText(card: ScryfallCard): { 
  rulesText: string; 
  typeLine: string; 
  manaCost: string; 
  cmc: number;
  isDoubleFaced: boolean;
  powerToughness?: string;
  cardFaces?: Array<{
    name: string;
    typeLine: string;
    rulesText: string;
    manaCost: string;
    powerToughness?: string;
  }>;
  producesTokens: boolean;
      tokenTypes?: Array<{ name: string; rulesText: string; powerToughness: string; colorIdentity: string; typeLine: string }>;
} {
  const isDoubleFaced = !!(card.card_faces && card.card_faces.length > 0);
  const producesTokens = !!(card.all_parts && card.all_parts.some(p => p.component === "token"));
  
  if (isDoubleFaced) {
    const text = card.card_faces!.map((f) => f.oracle_text || "").filter(Boolean).join("\n\n--- FACE DIVIDER ---\n\n");
    const mana = card.card_faces!.map((f) => f.mana_cost || "").filter(Boolean).join(" // ");
    return {
      rulesText: text,
      typeLine: card.type_line,
      manaCost: mana,
      cmc: typeof card.cmc === "number" ? card.cmc : 0,
      isDoubleFaced: true,
      cardFaces: card.card_faces!.map(f => ({
        name: f.name,
        typeLine: f.type_line,
        rulesText: f.oracle_text || "",
        manaCost: f.mana_cost || "",
        powerToughness: f.power && f.toughness ? `${f.power}/${f.toughness}` : undefined
      })),
      producesTokens,
      tokenTypes: producesTokens ? filterCopyTokens(card.all_parts!, card.oracle_text || "", card.name) : undefined
    };
  }
  
  return {
    rulesText: card.oracle_text || "",
    typeLine: card.type_line,
    manaCost: card.mana_cost || "",
    cmc: typeof card.cmc === "number" ? card.cmc : 0,
    isDoubleFaced: false,
    powerToughness: card.power && card.toughness ? `${card.power}/${card.toughness}` : undefined,
    producesTokens,
    tokenTypes: producesTokens ? filterCopyTokens(card.all_parts!, card.oracle_text || "", card.name) : undefined
  };
}

/**
 * Returns significant token type phrases from a token `type_line`.
 * Example: "Token Legendary Creature — Angel" -> ["angel"]
 *          "Token Creature — Eldrazi Spawn" -> ["eldrazi spawn", "eldrazi"]
 */
function extractTokenTypePhrases(typeLine?: string): string[] {
  if (!typeLine) return [];
  const dashSplit = typeLine.split('—');
  if (dashSplit.length < 2) return [];
  const subtypePart = dashSplit[1].trim();
  // Keep full phrase and individual words (for multi-word types like Eldrazi Spawn)
  const phrases: string[] = [];
  const lowerFull = subtypePart.toLowerCase();
  phrases.push(lowerFull);
  // Split on non-letters to get individual words; keep words of length >= 3 to avoid noise
  const words = lowerFull.split(/[^a-z]+/).filter(w => w.length >= 3);
  for (const w of words) {
    if (!phrases.includes(w)) phrases.push(w);
  }
  return phrases;
}

/**
 * Finds the specific sentence/clause of the card rules that creates the given token.
 * Prefers clauses that contain the token name; otherwise looks for any of the type phrases.
 */
function findCreationClauseForToken(rulesText: string, tokenName: string, tokenTypeLine?: string): string | null {
  const text = rulesText || '';
  if (!text) return null;
  const tokenNameLower = (tokenName || '').toLowerCase();
  const typePhrases = extractTokenTypePhrases(tokenTypeLine);

  // Split rules into sentences/clauses. Handle periods and line breaks; keep en/em dashes in place.
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(Boolean);

  // Helper to check if a sentence is a creation clause for this token
  const matchesThisToken = (s: string): boolean => {
    const lower = s.toLowerCase();
    if (!/\bcreate\b/.test(lower)) return false;
    if (tokenNameLower && lower.includes(tokenNameLower)) return true;
    return typePhrases.some(p => p && lower.includes(p));
  };

  const match = sentences.find(matchesThisToken);
  return match || null;
}

/**
 * Extracts token-specific rules text from the main card's rules text
 * This function targets two specific scenarios:
 * 1. Cards that create tokens with specific abilities (e.g., "Create a 4/4 Angel token with Flying and Vigilance")
 * 2. Cards that create tokens with specific characteristics (e.g., Kozilek's Predator style)
 */
export function extractTokenRulesFromCardRules(rulesText: string, tokenName: string, tokenTypeLine?: string): string {
  if (!rulesText || !tokenName) return "";
  
  const tokenNameLower = tokenName.toLowerCase();
  
  // Case 2: Look for quoted rules text first (highest priority)
  // Pattern: "They have 'Sacrifice this token: Add {C}.'" or similar quoted text
  const quotedRulesMatch = rulesText.match(/"([^"]+)"/);
  if (quotedRulesMatch) {
    const quotedText = quotedRulesMatch[1];
    // Check if the quoted text is likely token rules (mentions abilities, actions, etc.)
    if (quotedText.includes('token') || quotedText.includes('sacrifice') || quotedText.includes('add') || 
        quotedText.includes('{') || quotedText.includes('}') || quotedText.includes(':') ||
        quotedText.includes('this') || quotedText.includes('they')) {
      return quotedText;
    }
  }
  
  // Case 1: Find the specific creation clause for this token and extract abilities from it
  const creationClause = findCreationClauseForToken(rulesText, tokenName, tokenTypeLine);
  if (creationClause) {
    const specificMatch = creationClause.match(/\bwith\s+([^.]+)/i) 
      || creationClause.match(/\bthat\s+has\s+([^.]+)/i)
      || creationClause.match(/\bgains?\s+([^.]+)/i)
      || creationClause.match(/\bgets?\s+([^.]+)/i)
      || creationClause.match(/\bhas\s+([^.]+)/i);
  
    if (specificMatch && specificMatch[1]) {
    // Extract just the abilities part
    const abilities = specificMatch[1].trim();
    // Clean up common trailing words
    const cleanAbilities = abilities.replace(/\s+(?:and\s+)?(?:until\s+end\s+of\s+turn|this\s+turn|permanently)$/i, '');
    
    // Handle the case where keywords are already comma-separated
    // If the text already contains commas, we need to be more careful about "and" conversion
    if (cleanAbilities.includes(',')) {
      // For text like "flying, vigilance, and indestructible"
      // Replace " and " with ", " but avoid double commas
      const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ').replace(/,\s*,/g, ',');
      return formattedAbilities;
    } else {
      // For text like "flying and vigilance and indestructible"
      // Simple replacement is fine
      const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ');
      return formattedAbilities;
    }
    }
  }
  
  // Case 2: Look for token creation with power/toughness and abilities
  // Pattern: "Create a X/Y [Type] token" followed by ability granting
  const powerToughnessPattern = new RegExp(
    `create\\s+a?\\s*(\\d+\\/\\d+)\\s+(?:\\w+\\s+)?(?:${tokenNameLower.replace(/[^a-z0-9]/g, '\\w*')}|\\w+\\s+token)([^.]*)`,
    'i'
  );
  
  const ptMatch = rulesText.match(powerToughnessPattern);
  if (ptMatch) {
    const additionalText = ptMatch[2] || '';
    
    // Extract abilities from the additional text
    const abilityPatterns = [
      /with\s+([^.]+)/i,
      /that\s+has\s+([^.]+)/i,
      /gains?\s+([^.]+)/i,
      /gets?\s+([^.]+)/i
    ];
    
    for (const pattern of abilityPatterns) {
      const abilityMatch = additionalText.match(pattern);
      if (abilityMatch && abilityMatch[1]) {
        const abilities = abilityMatch[1].trim();
        const cleanAbilities = abilities.replace(/\s+(?:and\s+)?(?:until\s+end\s+of\s+turn|this\s+turn|permanently)$/i, '');
        
        // Handle the case where keywords are already comma-separated
        if (cleanAbilities.includes(',')) {
          const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ').replace(/,\s*,/g, ',');
          return formattedAbilities;
        } else {
          const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ');
          return formattedAbilities;
        }
      }
    }
    
    // If no specific abilities found, return empty string (not power/toughness)
    return "";
  }
  
  // Case 3: Look for simple power/toughness patterns for this specific token
  // This handles cases like "I — Create a 1/1 white Mouse creature token."
  const simplePTPattern = new RegExp(
    `(?:create|creates?)\\s+a?\\s*(\\d+\\/\\d+)\\s+[^.]*${tokenNameLower.replace(/[^a-z0-9]/g, '\\w*')}[^.]*`,
    'i'
  );
  
  const simplePTMatch = rulesText.match(simplePTPattern);
  if (simplePTMatch && simplePTMatch[1]) {
    // Don't return power/toughness as rules - return empty string
    return "";
  }
  
  // Case 4: Look for sentences that specifically mention this token by name
  const sentences = rulesText.split(/[.!]+/).filter(s => s.trim().length > 0);
  const tokenSpecificSentences = sentences.filter(sentence => {
    const sentenceLower = sentence.toLowerCase();
    
    // Must mention the token name specifically
    if (!sentenceLower.includes(tokenNameLower)) {
      return false;
    }
    
    // Look for ability granting patterns
    const abilityPatterns = [
      /with\s+([^.]+)/i,
      /that\s+has\s+([^.]+)/i,
      /gains?\s+([^.]+)/i,
      /gets?\s+([^.]+)/i,
      /has\s+([^.]+)/i
    ];
    
    return abilityPatterns.some(pattern => pattern.test(sentence));
  });
  
  if (tokenSpecificSentences.length > 0) {
    // Extract abilities from the first matching sentence
    const sentence = tokenSpecificSentences[0];
    const abilityPatterns = [
      /with\s+([^.]+)/i,
      /that\s+has\s+([^.]+)/i,
      /gains?\s+([^.]+)/i,
      /gets?\s+([^.]+)/i,
      /has\s+([^.]+)/i
    ];
    
                    for (const pattern of abilityPatterns) {
            const match = sentence.match(pattern);
            if (match && match[1]) {
              const abilities = match[1].trim();
              const cleanAbilities = abilities.replace(/\s+(?:and\s+)?(?:until\s+end\s+of\s+turn|this\s+turn|permanently)$/i, '');
              
              // Handle the case where keywords are already comma-separated
              if (cleanAbilities.includes(',')) {
                const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ').replace(/,\s*,/g, ',');
                return formattedAbilities;
              } else {
                const formattedAbilities = cleanAbilities.replace(/\s+and\s+/gi, ', ');
                return formattedAbilities;
              }
            }
          }
  }
  
  // If no specific abilities found, return empty string
  return "";
}

/**
 * Extracts power/toughness for tokens from the main card's rules text
 * This is separate from rules text since P/T is not rules
 */
export function extractTokenPowerToughness(rulesText: string, tokenName: string, tokenTypeLine?: string): string {
  if (!rulesText || !tokenName) return "";
  
  const tokenNameLower = tokenName.toLowerCase();
  const creationClause = findCreationClauseForToken(rulesText, tokenName, tokenTypeLine);
  if (creationClause) {
    const m = creationClause.match(/(\d+\/\d+)/);
    if (m && m[1]) return m[1];
  }
  
  // Look for power/toughness patterns for this specific token
  const ptPattern = new RegExp(
    `(?:create|creates?)\\s+a?\\s*(\\d+\\/\\d+)\\s+[^.]*${tokenNameLower.replace(/[^a-z0-9]/g, '\\w*')}[^.]*`,
    'i'
  );
  
  const ptMatch = rulesText.match(ptPattern);
  if (ptMatch && ptMatch[1]) {
    return ptMatch[1];
  }
  
  // Also check for more general patterns
  const generalPTPattern = new RegExp(
    `create\\s+a?\\s*(\\d+\\/\\d+)\\s+(?:\\w+\\s+)?(?:${tokenNameLower.replace(/[^a-z0-9]/g, '\\w*')}|\\w+\\s+token)`,
    'i'
  );
  
  const generalPTMatch = rulesText.match(generalPTPattern);
  if (generalPTMatch && generalPTMatch[1]) {
    return generalPTMatch[1];
  }
  
  return "";
}

/**
 * Extracts color identity for tokens from the main card's rules text
 * Returns colors in {U}{R} format for display on type line
 */
export function extractTokenColorIdentity(rulesText: string, tokenName: string, tokenTypeLine?: string): string {
  if (!rulesText || !tokenName) return "";
  
  const creationClause = findCreationClauseForToken(rulesText, tokenName, tokenTypeLine);
  const searchSpace = creationClause || rulesText;
  
  // Look for color patterns in token creation text
  // Colors may appear either before or after the token name when the token has a proper name.
  // We therefore simply scan the selected clause for color words.
  const colorText = searchSpace;
  const colors: string[] = [];
  const pushOnce = (sym: string) => { if (!colors.includes(sym)) colors.push(sym); };
  if (/\bwhite\b/i.test(colorText)) pushOnce('{W}');
  if (/\bblue\b/i.test(colorText)) pushOnce('{U}');
  if (/\bblack\b/i.test(colorText)) pushOnce('{B}');
  if (/\bred\b/i.test(colorText)) pushOnce('{R}');
  if (/\bgreen\b/i.test(colorText)) pushOnce('{G}');
  if (/\bcolorless\b/i.test(colorText)) pushOnce('{C}');
  if (colors.length > 0) return colors.join('');
  
  return "";
}

/**
 * Intelligently filters out tokens that are just copies of the original card
 * This prevents generating proxies for tokens like Scute Swarm copies
 * Returns token objects with name, rules text, and type line for meaningful tokens
 */
export function filterCopyTokens(allParts: Array<{ id: string; component: string; name: string; type_line: string; oracle_text?: string }>, rulesText: string, cardName: string): Array<{ name: string; rulesText: string; powerToughness: string; colorIdentity: string; typeLine: string }> {
  const tokens = allParts.filter(p => p.component === "token");
  
  // If no tokens, return empty array
  if (tokens.length === 0) return [];
  
  // Check if the card creates copies of itself
  const createsSelfCopies = detectSelfCopyMechanics(rulesText, cardName);
  
  const filteredTokens = tokens
    .filter(token => {
      // Always filter out tokens with "copy" in the name
      if (token.name.toLowerCase().includes('copy')) {
        return false;
      }
      
      // If the card creates copies of itself, filter out tokens that are too similar
      if (createsSelfCopies) {
        return !isSelfCopyToken(token, cardName);
      }
      
      // Keep other tokens (creatures, objects, etc.)
      return true;
    })
    .map(token => {
      // Try to get rules text from token first, fall back to extracting from main card rules
      let tokenRulesText = token.oracle_text || "";
      
      // If no token rules text, try to extract from the main card's rules text
      if (!tokenRulesText) {
        tokenRulesText = extractTokenRulesFromCardRules(rulesText, token.name, token.type_line);
      }
      
      // Extract power/toughness separately
      const powerToughness = extractTokenPowerToughness(rulesText, token.name, token.type_line);
      
      // Extract color identity
      const colorIdentity = extractTokenColorIdentity(rulesText, token.name, token.type_line);
      
      return {
        name: token.name,
        rulesText: tokenRulesText,
        powerToughness: powerToughness,
        colorIdentity: colorIdentity,
        typeLine: token.type_line
      };
    });
  
  return filteredTokens;
}

/**
 * Detects if a card creates copies of itself based on rules text analysis
 */
export function detectSelfCopyMechanics(rulesText: string, cardName: string): boolean {
  const text = rulesText.toLowerCase();
  const name = cardName.toLowerCase();
  
  // Common patterns that indicate self-copying
  const selfCopyPatterns = [
    // Direct copy mechanics
    /copy.*itself/i,
    /copy.*this card/i,
    /copy.*\b\w+\b.*copy/i,
    
    // Scute Swarm style mechanics
    /whenever.*\w+.*enters.*copy/i,
    /create.*copy.*\w+/i,
    
    // Token generation that's likely self-copying
    /create.*\w+.*token.*copy/i,
    /token.*copy.*\w+/i,
    
    // Specific mechanics that often create copies
    /populate/i,
    /populate.*copy/i,
    
    // Look for patterns that mention the card's own name in copy context
    new RegExp(`copy.*${name.replace(/[^a-z0-9]/g, '.*')}`, 'i'),
    new RegExp(`${name.replace(/[^a-z0-9]/g, '.*')}.*copy`, 'i')
  ];
  
  return selfCopyPatterns.some(pattern => pattern.test(text));
}

/**
 * Determines if a specific token is a copy of the original card
 */
export function isSelfCopyToken(token: { name: string; type_line: string }, cardName: string): boolean {
  const tokenName = token.name.toLowerCase();
  const cardNameLower = cardName.toLowerCase();
  
  // Direct name similarity check
  if (tokenName.includes(cardNameLower) || cardNameLower.includes(tokenName)) {
    return true;
  }
  
  // Check if token type line is very similar to the original card
  // This catches cases where the token is essentially the same card type
  const originalTypeWords = cardName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  const tokenTypeWords = token.type_line.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  
  // If they share significant type words, likely a copy
  const sharedWords = originalTypeWords.filter(word => tokenTypeWords.includes(word));
  if (sharedWords.length >= 2) {
    return true;
  }
  
  // Check for specific copy indicators in the token name
  const copyIndicators = ['copy', 'clone', 'duplicate', 'replica', 'mirror'];
  if (copyIndicators.some(indicator => tokenName.includes(indicator))) {
    return true;
  }
  
  return false;
}

export function getGeneratedTokenHints(card: ScryfallCard): Array<{ name: string; type_line: string; rulesText: string }> {
  // Use all_parts for token relationships when available
  const parts = card.all_parts || [];
  const tokens = parts
    .filter((p) => p.component === "token")
    .filter(token => {
      // Apply the same filtering logic here for consistency
      if (token.name.toLowerCase().includes('copy')) {
        return false;
      }
      
      const createsSelfCopies = detectSelfCopyMechanics(card.oracle_text || "", card.name);
      if (createsSelfCopies) {
        return !isSelfCopyToken(token, card.name);
      }
      
      return true;
    });
  
  return tokens.map((p) => ({ 
    name: p.name, 
    type_line: p.type_line,
    rulesText: p.oracle_text || ""
  }));
}

export async function fetchScryfallNamedFuzzy(name: string): Promise<ScryfallCard | null> {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
  const resp = await fetch(url, { headers: scryfallHeaders() });
  if (!resp.ok) return null;
  const data = (await resp.json()) as (ScryfallCard & { object?: string }) | { object?: string; details?: string };
  if (data && "object" in data && data.object === "error") return null;
  return data as ScryfallCard;
}


