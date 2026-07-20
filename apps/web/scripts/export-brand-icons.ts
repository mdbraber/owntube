import fs from "node:fs/promises";
import path from "node:path";
import { toFullBleedIcon } from "@owntube/brand-icon";
import sharp from "sharp";
import toIco from "to-ico";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const VARIANTS = ["dark", "light"] as const;
const PNG_SIZES = [192, 512] as const;
const FAVICON_SIZE = 32;
const APPLE_TOUCH_SIZE = 180;
const TV_ASSETS_DIR = path.join(process.cwd(), "..", "tv", "assets");
const TV_ICON_SIZE = 512;
/** Android TV home-screen banner, fixed by the platform. */
const TV_BANNER_WIDTH = 320;
const TV_BANNER_HEIGHT = 180;
/** Share of the banner width the wordmark spans, leaving a safe margin. */
const TV_BANNER_FILL = 0.82;
/** Wordmark SVG viewBox width × height (see public/logo-wordmark-*.svg). */
const WORDMARK_VIEWBOX_WIDTH = 168;
const WORDMARK_EXPORT_WIDTH = WORDMARK_VIEWBOX_WIDTH * 3;

async function exportVariant(variant: (typeof VARIANTS)[number]) {
  const svgPath = path.join(PUBLIC_DIR, `logo-${variant}.svg`);
  const svgBuffer = await fs.readFile(svgPath);

  // Home-screen icons are full-bleed: iOS and Android round the corners
  // themselves, so shipping the logo's own tile and border would show a faint
  // second frame just inside theirs. The favicon and plain logo below keep the
  // tile — they are rendered as-is, not masked.
  const appIcon = Buffer.from(toFullBleedIcon(svgBuffer.toString("utf8")).svg);

  for (const size of PNG_SIZES) {
    const outputPath = path.join(PUBLIC_DIR, `logo-${variant}-${size}.png`);
    await sharp(appIcon).resize(size, size).png().toFile(outputPath);
  }

  if (variant === "dark") {
    await sharp(appIcon)
      .resize(APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE)
      .flatten()
      .png()
      .toFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
  }

  const faviconPng = await sharp(svgBuffer)
    .resize(FAVICON_SIZE, FAVICON_SIZE)
    .png()
    .toBuffer();
  const faviconIco = await toIco([faviconPng]);
  await fs.writeFile(
    path.join(PUBLIC_DIR, `favicon-${variant}.ico`),
    faviconIco,
  );

  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(PUBLIC_DIR, `logo-${variant}.png`));
}

async function exportWordmark(variant: (typeof VARIANTS)[number]) {
  const svgPath = path.join(PUBLIC_DIR, `logo-wordmark-${variant}.svg`);
  const svgBuffer = await fs.readFile(svgPath);
  const outputPath = path.join(PUBLIC_DIR, `logo-wordmark-${variant}.png`);

  await sharp(svgBuffer)
    .resize(WORDMARK_EXPORT_WIDTH, null, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);
}

/**
 * The TV app's bundled brand images are generated here rather than in apps/tv:
 * that app is deliberately outside the pnpm workspace (Expo's React 18 clashes
 * with web's React 19), so it cannot depend on @owntube/brand-icon itself.
 *
 * The launcher icon is full-bleed for the same reason as every other app icon —
 * Android masks it — and Android TV additionally needs a 320x180 banner for the
 * home-screen row.
 */
async function exportTvAssets() {
  const logo = await fs.readFile(
    path.join(PUBLIC_DIR, "logo-dark.svg"),
    "utf8",
  );
  const { svg, background } = toFullBleedIcon(logo);
  const icon = Buffer.from(svg);

  await sharp(icon)
    .resize(TV_ICON_SIZE, TV_ICON_SIZE)
    .png()
    .toFile(path.join(TV_ASSETS_DIR, "icon.png"));

  // Render at high density, then trim: sharp otherwise rasterises the SVG at
  // its intrinsic 168px width, and the wordmark's own transparent padding means
  // scaling the whole file leaves the visible mark far smaller than intended
  // (it filled ~52% of the tile before). Trimming first makes TV_BANNER_FILL
  // describe the artwork itself.
  const wordmark = await sharp(
    await fs.readFile(path.join(PUBLIC_DIR, "logo-wordmark-dark.svg")),
    { density: 600 },
  )
    .trim()
    .resize({
      width: Math.round(TV_BANNER_WIDTH * TV_BANNER_FILL),
      height: Math.round(TV_BANNER_HEIGHT * TV_BANNER_FILL),
      fit: "inside",
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: TV_BANNER_WIDTH,
      height: TV_BANNER_HEIGHT,
      channels: 4,
      background,
    },
  })
    .composite([{ input: wordmark, gravity: "center" }])
    .png()
    .toFile(path.join(TV_ASSETS_DIR, "banner.png"));

  // The in-app logo/wordmark the TV shell renders, kept in step with the web.
  for (const name of ["logo-dark.png", "logo-wordmark-dark.png"] as const) {
    await fs.copyFile(
      path.join(PUBLIC_DIR, name),
      path.join(TV_ASSETS_DIR, name.replace("-dark", "")),
    );
  }
}

async function main() {
  for (const variant of VARIANTS) {
    await exportVariant(variant);
    await exportWordmark(variant);
  }
  await exportTvAssets();
  console.log("Brand icons exported to public/ and ../tv/assets/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
