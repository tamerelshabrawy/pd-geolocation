/**
 * geolocation.js — Alexandria Pedestrian Soundwalk
 * Pure geolocation logic: route projection, weighted zone mapping, polygon detection.
 * No UI, no pd4web dependencies — fully testable in isolation.
 *
 * The walk is a RECTANGULAR anti-clockwise loop (~1709 m total) in Alexandria, Egypt.
 * Four sides (from alexandria_pedestrian_route.geojson, right_side feature):
 *
 *   BOTTOM  El Horeya Road      Start (bottom-right) → west → bottom-left corner
 *           coords 0–7          0 % → 18.9 % of arc  (~323 m)
 *
 *   LEFT    Safeya Zaghloul St  bottom-left corner → north → top-left corner
 *           coords 7–25         18.9 % → 54.8 % of arc  (~613 m, longest side)
 *
 *   TOP     Seafront / Corniche top-left corner → east → top-right corner
 *           coords 25–29        54.8 % → 62.8 % of arc  (~138 m, shortest side)
 *
 *   RIGHT   El Naby Danial St   top-right corner → south → back to start
 *           coords 29–51        62.8 % → 100 % of arc  (~635 m)
 *
 * Anti-clockwise direction (as walked):
 *   Start (bottom-right) → WEST along El Horeya → NORTH up Safeya Zaghloul →
 *   EAST along seafront  → SOUTH down El Naby Danial → back to start.
 *
 * Zones 1–35 map to the route arc with artistic weighting:
 *   Zones  1– 6  Track 1      bottom + start of Safeya Zaghloul  (~18% of arc)
 *   Zones  7–10  Transition   continuing north up Safeya Zaghloul (~ 8% of arc)
 *   Zones 11–25  Track 2      main arc up Safeya Zaghloul         (~32% of arc)
 *   Zones 26–27  Transition   top-left corner + entire seafront   (~ 5% of arc)
 *   Zones 28–31  Track 3      top-right corner + upper El Naby    (~20% of arc)
 *   Zones 32–35  Track 4      lower El Naby Danial back to start  (~17% of arc)
 */

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE COORDINATES
   right_side inner route from alexandria_pedestrian_route.geojson
   [longitude, latitude] — anti-clockwise walk order
   Total arc ≈ 1709 m across 4 sides.
   ───────────────────────────────────────────────────────────────────────── */
const ROUTE_LINE = [
    // ── BOTTOM: El Horeya Road (going west) ─────────────────────────────
    // Start: bottom-right corner, where El Horeya meets El Naby Danial
    // 0 % → 18.9 % of route arc
    [29.9042715, 31.1971886],
    [29.9040266, 31.1970967],
    [29.9038177, 31.1970196],
    [29.9035612, 31.1969195],
    [29.9032994, 31.1968217],
    [29.9030252, 31.1967192],
    [29.9026919, 31.1965935],
    [29.9011600, 31.1960329],   // ← bottom-left corner: El Horeya meets Safeya Zaghloul

    // ── LEFT: Safeya Zaghloul Street (going north) ───────────────────────
    // 18.9 % → 54.8 % of route arc (longest side, ~613 m)
    [29.9011093, 31.1961634],
    [29.9010739, 31.1962588],
    [29.9010204, 31.1963777],
    [29.9009838, 31.1964567],
    [29.9009196, 31.1966127],
    [29.9008214, 31.1968278],
    [29.9007290, 31.1970330],
    [29.9005354, 31.1974520],
    [29.9004363, 31.1976696],
    [29.9003473, 31.1978637],
    [29.9002448, 31.1980737],
    [29.9000878, 31.1984075],
    [29.8995214, 31.1996210],
    [29.8993131, 31.1997794],
    [29.8991065, 31.1999369],
    [29.8990220, 31.2001435],
    [29.8988634, 31.2004477],
    [29.8985785, 31.2010352],   // ← top-left corner: Safeya Zaghloul meets seafront

    // ── TOP: Seafront / Corniche (going east) ────────────────────────────
    // 54.8 % → 62.8 % of route arc (shortest side, ~138 m)
    [29.8988268, 31.2011214],
    [29.8992918, 31.2012976],
    [29.8995806, 31.2014050],   // ← northernmost point of the route

    // ── RIGHT: El Naby Danial Street (going south) ───────────────────────
    // 62.8 % → 100 % of route arc (~635 m, closes the rectangle)
    [29.8996133, 31.2010997],   // ← top-right corner: seafront meets El Naby Danial
    [29.9003518, 31.2009563],
    [29.9005950, 31.2007425],
    [29.9008607, 31.2005171],
    [29.9011287, 31.2002840],
    [29.9013854, 31.2000587],
    [29.9015999, 31.1998636],
    [29.9019591, 31.1995458],
    [29.9019591, 31.1995458],
    [29.9022687, 31.1992511],
    [29.9025586, 31.1989869],
    [29.9026791, 31.1988579],
    [29.9027810, 31.1987394],
    [29.9029072, 31.1985722],
    [29.9030305, 31.1984446],
    [29.9032732, 31.1982327],
    [29.9034668, 31.1981114],
    [29.9035805, 31.1980146],
    [29.9037191, 31.1978710],
    [29.9039240, 31.1976572],
    [29.9041345, 31.1974428],
    // End: back to start (bottom-right corner)
    [29.9042697, 31.1971939],
    [29.9042702, 31.1971939]
];

/* ─────────────────────────────────────────────────────────────────────────
   OUTER BOUNDARY (left_side from GeoJSON — used for polygon detection)
   ───────────────────────────────────────────────────────────────────────── */
const OUTER_BORDER = [
    [29.8985742,31.2008868],[29.8990142,31.199963],[29.8990518,31.1999074],
    [29.8991099,31.1998557],[29.899243,31.1997604],[29.8994968,31.1995653],
    [29.9002479,31.1980143],[29.9006458,31.1971429],[29.9009235,31.19653],
    [29.9010238,31.1962815],[29.9011116,31.1960526],[29.9011711,31.1959355],
    [29.9023496,31.1963765],[29.9042378,31.1970997],[29.9045246,31.1972019],
    [29.9047666,31.1973246],[29.9035848,31.1982192],[29.9025919,31.1990843],
    [29.902556,31.1991073],[29.9007485,31.200883],[29.9004258,31.2011948],
    [29.9000345,31.2015219],[29.8997148,31.2018949],[29.8987045,31.2014517],
    [29.8982799,31.2012772],[29.898292,31.2010923],[29.8984827,31.2009557],
    [29.8985562,31.2009262],[29.8985764,31.2008867]
];

/**
 * Zone detection polygon: outer boundary + reversed inner route + close.
 * NOTE: kept for reference/backward compatibility only — use nearRoute() for
 * reliable detection. The polygon approach produces incorrect results because
 * OUTER_BORDER and ROUTE_LINE do not share endpoints and create a
 * self-intersecting boundary that defeats ray-casting.
 */
const ZONE_POLYGON = OUTER_BORDER
    .concat(ROUTE_LINE.slice().reverse())
    .concat([OUTER_BORDER[0]]);

/* ─────────────────────────────────────────────────────────────────────────
   ARTISTIC ZONE BREAKPOINTS
   Maps 0→1 route progress to zones 1–35 using weighted segment widths.
   ZONE_BREAKPOINTS[i] is the upper bound (exclusive) of zone i+1.
   Last entry is exactly 1.0 (end of route).

   The four sides of the rectangle and their real arc proportions
   (verified against the GeoJSON, total route ≈ 1709 m):
     BOTTOM  El Horeya (going west)          0 % →  18.9 %  ~323 m
     LEFT    Safeya Zaghloul (going north)  18.9 % →  54.8 %  ~613 m
     TOP     Seafront (going east)          54.8 % →  62.8 %  ~138 m
     RIGHT   El Naby Danial (going south)   62.8 % → 100.0 %  ~635 m

   Artistic rationale per section:
     Zones  1– 6  (0–18 %):  Track 1 — El Horeya bottom + start of Safeya Zaghloul.
                              Compressed: the music opens quickly as the walk begins.
     Zones  7–10  (18–26 %): Transition — settling into the long northward climb.
     Zones 11–25  (26–58 %): Track 2 — the full stretch of Safeya Zaghloul.
                              Stretched: the longest musical arc, peak at zone 23.
     Zones 26–27  (58–63 %): Transition — top-left corner turn + entire seafront.
                              Compressed: the seafront is physically very short (~138 m).
     Zones 28–31  (63–83 %): Track 3 — top-right corner + upper El Naby Danial.
                              Stretched: downtempo, spacious, reaching ~54 % down
                              El Naby Danial (artist intent: "about 30 % of return leg").
     Zones 32–35  (83–100 %): Track 4 — lower El Naby Danial back to start.
                              Even spacing for the finale.
   ───────────────────────────────────────────────────────────────────────── */
const ZONE_BREAKPOINTS = [
    // ── Track 1: El Horeya Road bottom + start of Safeya Zaghloul (zones 1–6, 0%→18%) ──
    // Six zones across the bottom side and the first few steps north.
    // El Horeya naturally ends at ~18.9 % of the arc, so this feels physically
    // anchored — the music opens up right where the walker turns the corner.
    0.030, 0.060, 0.090, 0.120, 0.150, 0.180,

    // ── Transition T1→T2: Safeya Zaghloul lower stretch (zones 7–10, 18%→26%) ─
    // Four zones as the walk heads north and the music begins to open.
    0.200, 0.220, 0.240, 0.260,

    // ── Track 2: main arc up Safeya Zaghloul (zones 11–25, 26%→58%) ──────────
    // Fifteen zones spanning most of the LEFT side (Safeya Zaghloul).
    // Zone 23 is the musical peak; the zones spread evenly through this arc.
    // Safeya Zaghloul ends at ~54.8 % and the seafront begins, so zone 25
    // intentionally bleeds into the top-left corner turn.
    0.2813, 0.3027, 0.3240, 0.3453, 0.3667,
    0.3880, 0.4093, 0.4307, 0.4520, 0.4733,
    0.4947, 0.5160, 0.5373, 0.5587, 0.5800,

    // ── Transition T2→T3: top-left corner + entire seafront (zones 26–27, 58%→63%) ─
    // Two zones covering the turn at the top-left corner AND the entire short
    // seafront/corniche (physically only ~138 m, i.e. 54.8%→62.8 % of arc).
    // Compressed deliberately — the seafront is a brief, dramatic pivot.
    0.6050, 0.6300,

    // ── Track 3: El Naby Danial upper section (zones 28–31, 63%→83%) ────────
    // Four zones, each ~5 % wide — downtempo and spacious. Begins at the
    // top-right corner (62.8 % of arc) and stretches about 54 % down
    // El Naby Danial before handing off to Track 4.
    0.6800, 0.7300, 0.7800, 0.8300,

    // ── Track 4: El Naby Danial lower + back to start (zones 32–35, 83%→100%) ─
    // Four evenly-spaced zones for the finale heading back to the start point.
    0.8725, 0.9150, 0.9575, 1.0000
];

/* ─────────────────────────────────────────────────────────────────────────
   ZONE → FAMILY (matches Pd's alexandria_family_progress_morph.pd)
   Index 0 is unused (zones are 1-based).
   Family boundaries trigger morph holds in the Pd patch.
   ───────────────────────────────────────────────────────────────────────── */
const ZONE_FAMILIES = [
    0,                   // [0] unused placeholder
    0, 0, 0, 0, 0,       // zones  1– 5 → family 0 (Track 1)
    1, 1, 1, 1, 1,       // zones  6–10 → family 1 (Transition + opening of T2)
    2, 2, 2, 2,          // zones 11–14 → family 2 (Track 2 build)
    3, 3, 3, 3, 3,       // zones 15–19 → family 3 (Track 2 mid)
    4, 4, 4, 4, 4,       // zones 20–24 → family 4 (Track 2 peak & fade)
    5, 5, 5,             // zones 25–27 → family 5 (Track 2 fade + corner)
    6, 6, 6, 6,          // zones 28–31 → family 6 (Track 3 seafront)
    7, 7, 7, 7           // zones 32–35 → family 7 (Track 4 finale)
];

/** Human-readable name for each family/track section. */
const FAMILY_LABELS = [
    'Track 1',      // family 0
    'Transition',   // family 1
    'Track 2',      // family 2
    'Track 2',      // family 3
    'Track 2',      // family 4
    'Transition',   // family 5
    'Track 3',      // family 6
    'Track 4'       // family 7
];

/* ─────────────────────────────────────────────────────────────────────────
   CORE FUNCTIONS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Return the shortest metric distance (metres) from [lon, lat] to the
 * nearest point on the route polyline.  Uses the equirectangular
 * approximation — accurate to <1 % over distances < 10 km.
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number,number]>} line
 * @returns {number} distance in metres
 */
function distanceToRoute(lon, lat, line) {
    const toRad = d => d * Math.PI / 180;
    const cosLat = Math.cos(toRad((lat + line[0][1]) / 2));
    const mPerDegLat = 111319;
    const mPerDegLon = 111319 * cosLat;
    let minDist = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const ax = line[i][0],   ay = line[i][1];
        const bx = line[i + 1][0], by = line[i + 1][1];
        const dx = bx - ax, dy = by - ay;
        const lsq = dx * dx + dy * dy;
        const t = lsq > 0
            ? Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / lsq))
            : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const dlonM = (lon - px) * mPerDegLon;
        const dlatM = (lat - py) * mPerDegLat;
        const d = Math.sqrt(dlonM * dlonM + dlatM * dlatM);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * Return true if the walker is within thresholdM metres of the route line.
 * This is the recommended way to detect whether the walker is on the route.
 * The problem statement specifies a ~45 m detection radius.
 * @param {number} lon
 * @param {number} lat
 * @param {number} [thresholdM=45]
 * @returns {boolean}
 */
function nearRoute(lon, lat, thresholdM = 45) {
    return distanceToRoute(lon, lat, ROUTE_LINE) <= thresholdM;
}

/**
 * Ray-casting point-in-polygon test (kept for general use).
 * NOTE: do NOT use this with ZONE_POLYGON for route detection —
 * use nearRoute() instead.
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {Array<[number,number]>} poly - Array of [lon, lat] pairs
 * @returns {boolean}
 */
function pointInPolygon(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

/**
 * Project a [lon, lat] point onto the polyline and return 0→1 progress.
 * Uses squared-distance in geographic coordinates (suitable for ~1km scale).
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number,number]>} line
 * @returns {number} 0.0 → 1.0
 */
function projectOntoPolyline(lon, lat, line) {
    // Pre-compute segment lengths
    const segs = [];
    let total = 0;
    for (let i = 0; i < line.length - 1; i++) {
        const dx = line[i + 1][0] - line[i][0];
        const dy = line[i + 1][1] - line[i][1];
        const len = Math.sqrt(dx * dx + dy * dy);
        segs.push(len);
        total += len;
    }

    let best = Infinity, bestAccum = 0, accum = 0;
    for (let i = 0; i < line.length - 1; i++) {
        const ax = line[i][0],   ay = line[i][1];
        const bx = line[i + 1][0], by = line[i + 1][1];
        const dx = bx - ax, dy = by - ay;
        const lsq = dx * dx + dy * dy;
        const t = lsq > 0
            ? Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / lsq))
            : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d = (lon - px) * (lon - px) + (lat - py) * (lat - py);
        if (d < best) {
            best = d;
            bestAccum = accum + t * segs[i];
        }
        accum += segs[i];
    }
    return total > 0 ? bestAccum / total : 0;
}

/**
 * Map 0→1 route progress to a zone number 1–35 using the weighted breakpoints.
 * Uses binary search over ZONE_BREAKPOINTS for O(log n) lookup.
 * @param {number} p - Progress 0.0 → 1.0
 * @returns {number} Integer zone 1–35
 */
function progressToZone(p) {
    // Clamp input
    if (p <= 0) return 1;
    if (p >= 1) return 35;

    // Binary search: find first breakpoint ≥ p
    let lo = 0, hi = ZONE_BREAKPOINTS.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ZONE_BREAKPOINTS[mid] < p) lo = mid + 1;
        else hi = mid;
    }
    // lo is the 0-based index in ZONE_BREAKPOINTS, zone number is lo+1
    return lo + 1;
}

/**
 * Return the track/section label for a given zone number (1–35).
 * @param {number} zone - Integer 1–35
 * @returns {string} e.g. "Track 1", "Track 2", "Transition", "Track 3", "Track 4"
 */
function zoneToTrackLabel(zone) {
    if (zone < 1 || zone > 35) return '';
    const family = ZONE_FAMILIES[zone];
    return FAMILY_LABELS[family] || '';
}

/**
 * Return the family number (0–7) for a given zone (1–35).
 * @param {number} zone
 * @returns {number}
 */
function zoneToFamily(zone) {
    if (zone < 1 || zone > 35) return -1;
    return ZONE_FAMILIES[zone];
}

/* ─────────────────────────────────────────────────────────────────────────
   EXPORT — works as a browser global OR as a CommonJS/ESM module for testing
   ───────────────────────────────────────────────────────────────────────── */
const GeoLogic = {
    ROUTE_LINE,
    OUTER_BORDER,
    ZONE_POLYGON,
    ZONE_BREAKPOINTS,
    ZONE_FAMILIES,
    FAMILY_LABELS,
    distanceToRoute,
    nearRoute,
    pointInPolygon,
    projectOntoPolyline,
    progressToZone,
    zoneToTrackLabel,
    zoneToFamily
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeoLogic;
} else if (typeof window !== 'undefined') {
    window.GeoLogic = GeoLogic;
}
