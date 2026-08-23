const PRODUCT_NUMBER_PATTERN = /\b\d{4,7}\b/g;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;
const PIECE_COUNT_SUFFIX_PATTERN =
  /^\s*(?:pi[eè]ces?|pieces?|parts?|teile)\b/i;
const HARD_EXCLUSION_PATTERN =
  /\b(?:ersatzteile?|einzelteile?|kleinteile?|anleitungen?|bauanleitungen?|manual|instructions?|stickers?|aufkleber|leerkarton|ovp\s*leer|box\s*only|empty\s*box|unvollst[aä]ndig|incomplete|ohne\s+(?:figuren|minifiguren|steine|teile|anleitung|ovp)|moc|custom|kompatibel|compatible|konvolut|bundle|parts?\s*only|minifig(?:ur(?:e|en)?|ure?s?)\s*only|vitrinen?|schauk[aä]sten?|schutzhauben?|staubschutz|display\s*(?:case|box|stand)|showcase|acryl(?:glas)?(?:box|haube|vitrine)?|acrylic\s*(?:case|box|display)|light(?:ing)?\s*kit|led\s*(?:kit|beleuchtung)|beleuchtungs(?:set|kit)|wandhalterung|wall\s*mount)\b/i;
const FRENCH_ACCESSORY_PATTERN =
  /\b(?:kit d eclairage|kit eclairage|kit de lumiere|kit lumiere|kit led|eclairage(?:s)?(?: led)?|lumiere(?:s)?(?: led)?|lampe(?:s)?(?: led)?|veilleuse(?:s)?|vitrine(?:s)?|presentoir(?:s)?|support d exposition|socle d exposition|boite(?:s)? acrylique(?:s)?|boite(?:s)? de protection|housse(?:s)? anti poussiere|protection(?:s)? anti poussiere|support(?:s)? mural|boite(?:s)? vide(?:s)?|boite(?:s)? seule(?:s)?|emballage(?:s)? vide(?:s)?|notice(?:s)? seule(?:s)?|manuel(?:s)? seul(?:s)?|instructions? seule(?:s)?|sans (?:figurines?|minifigurines?|pieces?|briques?|boite|notice)|incomplet(?:e|es|s)?|pieces? detachees?|lot de pieces?|pieces? seules?|autocollants?|figurines? seules?|minifigurines? seules?|lot de (?:figurines?|minifigurines?)|pack de (?:figurines?|minifigurines?)|toutes les (?:figurines?|minifigurines?))\b/i;
const ACCESSORY_PATTERN =
  /\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?|steine|teile|parts?)\b/i;
const COMPLETE_SET_SIGNAL_PATTERN =
  /\b(?:set|komplett|vollst[aä]ndig|complete|sealed|ovp|neu|new|ungeöffnet|unopened)\b/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function foldFilterText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFrenchAccessorySignal(title) {
  const text = foldFilterText(title);
  return Boolean(text) && FRENCH_ACCESSORY_PATTERN.test(text);
}

function hasExactSetNumber(title, setNumber) {
  const escapedSetNumber = escapeRegExp(setNumber);
  return new RegExp(
    `(?:^|[^0-9])${escapedSetNumber}(?:[^0-9]|$)`
  ).test(title);
}

function hasConflictingProductNumber(title, setNumber) {
  return [...title.matchAll(PRODUCT_NUMBER_PATTERN)].some((match) => {
    const candidate = match[0];
    if (candidate === setNumber || YEAR_PATTERN.test(candidate)) return false;

    const suffix = title.slice((match.index || 0) + candidate.length);
    return !PIECE_COUNT_SUFFIX_PATTERN.test(suffix);
  });
}

function hasMinifigureOnlySignal(title, setNumber) {
  const escapedSetNumber = escapeRegExp(setNumber);
  return new RegExp(
    [
      "\\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\s*" +
        "(?:set|pack|bundle|lot|sammlung|collection)\\b",
      "\\b(?:set|pack|bundle|lot|sammlung|collection)\\s+" +
        "(?:of\\s+|von\\s+)?(?:\\d+\\s+)?" +
        "(?:lego\\s+)?(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\b",
      "\\b(?:alle|all)\\s+(?:\\d+\\s+)?" +
        "(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\b",
      "\\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\s+" +
        "(?:aus|from)\\s+(?:dem\\s+)?(?:lego\\s+)?(?:set\\s+)?" +
        `${escapedSetNumber}\\b`
    ].join("|"),
    "i"
  ).test(title);
}

function hasAccessoryWithoutCompleteSetSignal(title) {
  return ACCESSORY_PATTERN.test(title) &&
    !COMPLETE_SET_SIGNAL_PATTERN.test(title);
}

export function isCompleteEbaySetTitle(
  title,
  setNumber,
  titleLocale = "de"
) {
  if (!hasExactSetNumber(title, setNumber)) return false;
  if (hasConflictingProductNumber(title, setNumber)) return false;
  if (HARD_EXCLUSION_PATTERN.test(title)) return false;
  if (titleLocale === "fr" && hasFrenchAccessorySignal(title)) return false;
  if (hasMinifigureOnlySignal(title, setNumber)) return false;
  return !hasAccessoryWithoutCompleteSetSignal(title);
}
