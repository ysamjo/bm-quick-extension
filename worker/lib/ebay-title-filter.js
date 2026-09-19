const PRODUCT_NUMBER_PATTERN = /\b\d{4,7}\b/g;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;
const PIECE_COUNT_SUFFIX_PATTERN =
  /^\s*(?:pi[eè]ces?|pieces?|parts?|teile)\b/i;
// Kanonische Ausschlussliste fuer Angebotstitel. Wortgleich mit
// globalThis.BM_EXCLUDED_OFFER_TITLE_PATTERN in Userscript/src/shared.js - der
// Client kann als Classic Script nichts importieren, deshalb steht das Literal
// dort noch einmal. worker/test/exclusion-pattern-sync.test.js schlaegt fehl,
// sobald die beiden auseinanderlaufen.
export const HARD_EXCLUSION_PATTERN =
  /\b(?:ersatzteile?|einzelteile?|kleinteile?|anleitungen?|bauanleitungen?|manuals?|instructions?|stickers?|aufkleber|leerkarton|leere\s+(?:ovp|box|verpackung)|ovp\s*leer|box\s*only|empty\s*box|unvollst[aä]ndig|incomplete|incomplet(?:e|es|s)?|ohne\s+(?:figuren|minifiguren|steine|teile|anleitung|ovp)|sans\s+(?:figurines?|minifigurines?|pi[eè]ces?|briques?|bo[iî]te|notice)|moc|custom|kompatibel|compatible|konvolut|bundle|parts?\s*only|(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)\s*only|figurines?\s+seules?|minifigurines?\s+seules?|lot\s+(?:de\s+|of\s+|von\s+)?(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|pack\s+(?:de\s+|of\s+)?(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|set\s+(?:de\s+|of\s+|aus\s+)(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|toutes\s+les\s+(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|nur\s+(?:die\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|(?:only|just)\s+(?:\d+\s+)?(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)|(?:minifigs?|minifigure?s?|minifiguren?|minifigurines?|figure?n?|figurines?)(?:[^\n,;]{0,60}?)\s+(?:du|from|aus|vom)\s+(?:dem\s+|der\s+|the\s+)?set|(?:[a-z]{2,5}\d{3,5}[a-z]?\s+(?:figurines?|minifigs?|minifigure?s?|minifiguren?|figure?n?)|(?:figurines?|minifigs?|minifigure?s?|minifiguren?|figure?n?)\s+[a-z]{2,5}\d{3,5}[a-z]?)|pi[eè]ces?\s+d[eé]tach[eé]es?|lot\s+de\s+pi[eè]ces?|pi[eè]ces?\s+seules?|autocollants?|vitrinen?|schauk[aä]sten?|schutzhauben?|staubschutz|display\s*(?:case|box|stand)|showcase|acryl(?:glas)?(?:box|haube|vitrine)?|acrylic\s*(?:case|box|display)|pr[eé]sentoir(?:s)?|support(?:s)?\s+(?:mural|d['’]?exposition)|socle(?:s)?\s+d['’]?exposition|bo[iî]te(?:s)?\s+(?:acrylique|de\s+protection|vide|seule)|housse(?:s)?\s+anti[- ]?poussi[eè]re|protection(?:s)?\s+anti[- ]?poussi[eè]re|light(?:ing)?[- ]?(?:kits?|sets?)|(?:led[- ]?)?licht[- ]?(?:sets?|kits?)|(?:led[- ]?)?beleuchtungs?[- ]?(?:sets?|kits?)|led[- ]?(?:ferngesteuerte[s|r|n]?|mit\s+fernbedienung|fernbedienung|remote[- ]?control(?:led)?|wireless|kabellose[s|r|n]?|funk[- ]?)?\s*(?:licht[- ]?|beleuchtungs?[- ]?)?(?:beleuchtung|leuchten|lampen|strip|streifen|kits?|sets?)|(?:ferngesteuerte[s|r|n]?|kabellose[s|r|n]?|remote[- ]?control(?:led)?)\s+(?:led[- ]?|licht[- ]?|beleuchtungs?[- ]?)(?:kits?|sets?)|(?:led[- ]?)?kit[- ]?led|kit(?:[- ]*(?:d['’\s]*|de\s*)?|s\s+)?(?:led|lumi[eè]res?|[eé]clairages?|light(?:ing)?)(?:\s+(?:t[eé]l[eé]command[eé](?:e|es|s)?|avec\s+t[eé]l[eé]commande))?|(?:led[- ]?)?[eé]clairage(?:s)?(?:\s+led)?|(?:led[- ]?)?lumi[eè]re(?:s)?(?:\s+led)?|t[eé]l[eé]command[eé](?:e|es|s)?|nur\s+(?:das\s+)?(?:licht|led|beleuchtung)|(?:ohne|kein|sans|without)\s+(?:lego|modell|briques?|mod[eè]le)|(?:lego|modell|briques?|mod[eè]le)\s+(?:nicht\s+(?:enthalten|inklusive)|non\s+inclus(?:es?)?|not\s+included)|briksmax|lightailing|light\s*my\s*bricks|game\s*of\s*bricks|brickbling|yeabricks|kyglaring|vonado|lelightgo|brickshine|another[- ]?brick(?:[- ]?shop)?|wandhalterung|wall\s*mount|(?:bausteine?|klemmbausteine?)[- ]?(?:set|bausatz)?\s*(?:wie|ähnlich|ahnlich)|(?:wie|ähnlich|ahnlich)\s+lego|(?:nicht\s+von\s+lego|kein\s+lego|keine\s+lego|not\s+lego|no\s+lego|nicht\s+original\s+lego)|(?:building[- ]?)?block[- ]?sets?|china[- ]?(?:klon|clone)s?|(?:lego[- ]?)?plagiat(?:e)?|(?:fake|kopie)[- ]?lego|knock[- ]?offs?|bootlegs?|mould[- ]?king|mold[- ]?king|cobi|lepin|bluebrixx|blue[- ]?brixx|cada|ca[- ]?da|xingbao|sembo(?:\s*blocks?)?|sluban|qman|keeppley|panlos(?:\s*brick)?|reobrix|pantasy|funwhole|decool|forange|leji|sy\s*blocks?|wange\s*(?:blocks?|bricks?|set|bausteine?)|kazi\s*(?:blocks?|bricks?|set|bausteine?)|star\s*plan|space\s*wars)\b/i;
const FRENCH_ACCESSORY_PATTERN =
  /\b(?:kit d eclairage|kit eclairage|kit de lumiere|kit lumiere|kit led|kit telecommande|eclairage(?:s)?(?: led)?|lumiere(?:s)?(?: led)?|lampe(?:s)?(?: led)?|ruban(?:s)? led|bande(?:s)? led|spot(?:s)? led|veilleuse(?:s)?|vitrine(?:s)?|presentoir(?:s)?|support d exposition|socle d exposition|boite(?:s)? acrylique(?:s)?|boite(?:s)? de protection|housse(?:s)? anti poussiere|protection(?:s)? anti poussiere|support(?:s)? mural|boite(?:s)? vide(?:s)?|boite(?:s)? seule(?:s)?|emballage(?:s)? vide(?:s)?|notice(?:s)? seule(?:s)?|manuel(?:s)? seul(?:s)?|instructions? seule(?:s)?|sans (?:figurines?|minifigurines?|pieces?|briques?|boite|notice|lego)|(?:lego|modele|briques?)\s+(?:non inclus(?:es?)?|pas inclus(?:es?)?)|incomplet(?:e|es|s)?|pieces? detachees?|lot de pieces?|pieces? seules?|autocollants?|figurines? seules?|minifigurines? seules?|lot de (?:figurines?|minifigurines?)|pack de (?:figurines?|minifigurines?)|toutes les (?:figurines?|minifigurines?))\b/i;
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

export function hasFrenchAccessorySignal(title) {
  const text = foldFilterText(title);
  return Boolean(text) && FRENCH_ACCESSORY_PATTERN.test(text);
}

const EXACT_SET_CACHE_LIMIT = 50;
const exactSetPatternCache = new Map();

function getExactSetPattern(setNumber) {
  const key = String(setNumber).trim();
  let pattern = exactSetPatternCache.get(key);
  if (pattern) {
    exactSetPatternCache.delete(key);
    exactSetPatternCache.set(key, pattern);
    return pattern;
  }
  if (exactSetPatternCache.size >= EXACT_SET_CACHE_LIMIT) {
    const oldestKey = exactSetPatternCache.keys().next().value;
    exactSetPatternCache.delete(oldestKey);
  }
  const escapedSetNumber = escapeRegExp(key);
  pattern = new RegExp(`(?:^|[^0-9])${escapedSetNumber}(?:[^0-9]|$)`);
  exactSetPatternCache.set(key, pattern);
  return pattern;
}

export function hasExactSetNumber(title, setNumber) {
  const titleText = String(title || "").trim();
  const key = String(setNumber || "").trim();
  if (!titleText || !key) return false;
  return getExactSetPattern(key).test(titleText);
}

export function hasConflictingProductNumber(title, setNumber) {
  const titleText = String(title || "");
  const targetSet = String(setNumber || "").trim();
  if (!targetSet) return false;
  return [...titleText.matchAll(PRODUCT_NUMBER_PATTERN)].some((match) => {
    const candidate = match[0];
    if (candidate === targetSet || YEAR_PATTERN.test(candidate)) return false;

    const suffix = titleText.slice((match.index || 0) + candidate.length);
    return !PIECE_COUNT_SUFFIX_PATTERN.test(suffix);
  });
}

const STATIC_MINIFIGURE_SIGNAL_PATTERN = new RegExp(
  [
    "\\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\s*" +
      "(?:set|pack|bundle|lot|sammlung|collection)\\b",
    "\\b(?:set|pack|bundle|lot|sammlung|collection)\\s+" +
      "(?:of\\s+|von\\s+)?(?:\\d+\\s+)?" +
      "(?:lego\\s+)?(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\b",
    "\\b(?:alle|all)\\s+(?:\\d+\\s+)?" +
      "(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\b"
  ].join("|"),
  "i"
);

const SET_MINIFIGURE_CACHE_LIMIT = 50;
const setMinifigurePatternCache = new Map();

function getSetMinifigurePattern(setNumber) {
  const key = String(setNumber).trim();
  let pattern = setMinifigurePatternCache.get(key);
  if (pattern) {
    setMinifigurePatternCache.delete(key);
    setMinifigurePatternCache.set(key, pattern);
    return pattern;
  }
  if (setMinifigurePatternCache.size >= SET_MINIFIGURE_CACHE_LIMIT) {
    const oldestKey = setMinifigurePatternCache.keys().next().value;
    setMinifigurePatternCache.delete(oldestKey);
  }
  const escapedSetNumber = escapeRegExp(key);
  pattern = new RegExp(
    `\\b(?:minifig(?:ur(?:e|en)?|ure?s?)|figuren?)\\s+(?:aus|from|du|vom)\\s+(?:dem\\s+|der\\s+|the\\s+)?(?:lego\\s+)?(?:set\\s+)?${escapedSetNumber}\\b`,
    "i"
  );
  setMinifigurePatternCache.set(key, pattern);
  return pattern;
}

export function hasMinifigureOnlySignal(title, setNumber) {
  const titleText = String(title || "").trim();
  if (!titleText) return false;
  if (STATIC_MINIFIGURE_SIGNAL_PATTERN.test(titleText)) return true;
  const key = String(setNumber || "").trim();
  if (!key) return false;
  return getSetMinifigurePattern(key).test(titleText);
}

function hasAccessoryWithoutCompleteSetSignal(title) {
  const text = String(title || "");
  return ACCESSORY_PATTERN.test(text) &&
    !COMPLETE_SET_SIGNAL_PATTERN.test(text);
}

export function isCompleteEbaySetTitle(
  title,
  setNumber,
  titleLocale = "de"
) {
  const normalizedTitle = String(title || "").trim();
  const normalizedSetNumber = String(setNumber || "").trim();
  if (!normalizedTitle || !normalizedSetNumber) return false;
  if (!hasExactSetNumber(normalizedTitle, normalizedSetNumber)) return false;
  if (hasConflictingProductNumber(normalizedTitle, normalizedSetNumber)) return false;
  if (HARD_EXCLUSION_PATTERN.test(normalizedTitle)) return false;
  if (hasFrenchAccessorySignal(normalizedTitle)) return false;
  if (hasMinifigureOnlySignal(normalizedTitle, normalizedSetNumber)) return false;
  return !hasAccessoryWithoutCompleteSetSignal(normalizedTitle);
}
