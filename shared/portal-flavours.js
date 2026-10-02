/*
  Per-flavour manufacturing and quality-check progress stored on a booking.

  Only name, packs, and the completion fields are copied onto the factory board.
  Price and any other booking field on a flavour row never leave this list.
*/

function when(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toMillis === "function") return new Date(value.toMillis()).toISOString();
  if (typeof value === "string") return value;
  return "";
}

/* One flavour as the factory team and the customer progress list may see it. */
export function flavourProgress(flavour) {
  if (!flavour || typeof flavour !== "object") return null;
  const name = String(flavour.name || "").trim();
  if (!name) return null;
  const row = { name, packs: Number(flavour.packs) || 0 };
  const made = when(flavour.mfg_at);
  const checked = when(flavour.qc_at);
  if (made) row.mfg_at = made;
  if (checked) row.qc_at = checked;
  if (typeof flavour.qc_path === "string" && flavour.qc_path) row.qc_path = flavour.qc_path;
  return row;
}

export function flavourRows(flavours) {
  return (Array.isArray(flavours) ? flavours : []).map(flavourProgress).filter(Boolean);
}

export function allFlavoursMade(flavours) {
  const rows = Array.isArray(flavours) ? flavours.filter((f) => f && String(f.name || "").trim()) : [];
  return rows.length > 0 && rows.every((f) => Boolean(when(f.mfg_at)));
}
