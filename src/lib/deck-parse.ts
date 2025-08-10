export type ParsedLine = {
  quantity: number;
  name: string;
  note?: string;
  is_commander: boolean;
};

// Parse plaintext deck input. Supports lines like:
// 1 Sol Ring
// 3 Lightning Bolt
// Commander: Atraxa, Praetors' Voice
// Kenrith, the Returned King // note: make him Mon Mothma
export function parseDeckText(input: string): ParsedLine[] {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const results: ParsedLine[] = [];
  for (const line of lines) {
    const commanderMatch = line.match(/^commander\s*:\s*(.+)$/i);
    if (commanderMatch) {
      const rest = commanderMatch[1].trim();
      let name = rest;
      let note: string | undefined;
      const parts = rest.split(/\s*\/\/\s*/);
      if (parts.length > 1) {
        name = parts[0];
        note = parts.slice(1).join(" // ");
      }
      results.push({ quantity: 1, name: name.trim(), note, is_commander: true });
      continue;
    }

    // quantity prefix
    const qtyMatch = line.match(/^(\d+)\s+(.+)$/);
    let quantity = 1;
    let rest = line;
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10) || 1;
      rest = qtyMatch[2];
    }

    // optional inline note delimiter ' // '
    let name = rest;
    let note: string | undefined;
    const parts = rest.split(/\s*\/\/\s*/);
    if (parts.length > 1) {
      name = parts[0];
      note = parts.slice(1).join(" // ");
    }

    results.push({ quantity, name: name.trim(), note, is_commander: false });
  }

  return results;
}


