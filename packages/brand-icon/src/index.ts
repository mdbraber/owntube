/**
 * Turns the brand logo into artwork suitable for an *app icon* — the square
 * image a phone shows on its home screen.
 *
 * The logo (apps/web/public/logo-{dark,light}.svg) draws its own rounded tile
 * plus a 12%-white border. That reads well inline on a page, but every platform
 * that renders an app icon applies its own rounded mask on top, so the logo's
 * border ends up as a faint second frame just inside the platform's corners.
 * The fix, and what other self-hosted frontends do (e.g. redlib's flat opaque
 * apple-touch-icon), is to ship a full-bleed square: no tile, no border, no
 * transparent corners, and let the platform do all the rounding.
 */

/** A rect this close to the full viewBox is the tile, not part of the mark. */
const TILE_COVERAGE = 0.9;

export type FullBleedIcon = {
  /** SVG markup: the mark on an edge-to-edge background, no tile or border. */
  svg: string;
  /** The tile's own fill, reused so the icon background can't drift. */
  background: string;
};

function attr(markup: string, name: string): string | undefined {
  return markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

/**
 * Strips the logo's tile and border and re-renders the mark edge to edge.
 *
 * Throws rather than guessing if the logo no longer looks the way we expect —
 * silently shipping a mis-derived icon is worse than failing the build.
 */
export function toFullBleedIcon(logoSvg: string): FullBleedIcon {
  const viewBox = attr(logoSvg, "viewBox");
  if (!viewBox) throw new Error("Logo SVG has no viewBox.");
  const [, , vbWidth, vbHeight] = viewBox.split(/\s+/).map(Number);

  const rects = [...logoSvg.matchAll(/<rect\b[^>]*\/>/g)].map((m) => ({
    markup: m[0],
    width: Number(attr(m[0], "width") ?? 0),
    height: Number(attr(m[0], "height") ?? 0),
    fill: attr(m[0], "fill"),
  }));

  const tiles = rects.filter(
    (r) =>
      r.width >= vbWidth * TILE_COVERAGE &&
      r.height >= vbHeight * TILE_COVERAGE,
  );
  if (tiles.length === 0) {
    throw new Error(
      "Found no full-size tile rect to strip — has the logo changed shape? " +
        "Check whether app icons still need this step.",
    );
  }

  const background = tiles.find((r) => r.fill && r.fill !== "none")?.fill;
  if (!background) {
    throw new Error("Logo tile has no fill colour to use as icon background.");
  }

  let mark = logoSvg;
  for (const tile of tiles) mark = mark.replace(tile.markup, "");

  // Re-inject a full-bleed background so the mark keeps the position it was
  // designed to have relative to the tile.
  const svg = mark.replace(
    /(<svg\b[^>]*>)/,
    `$1<rect x="0" y="0" width="${vbWidth}" height="${vbHeight}" fill="${background}"/>`,
  );

  return { svg, background };
}
