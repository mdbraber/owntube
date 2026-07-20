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

async function main() {
  for (const variant of VARIANTS) {
    await exportVariant(variant);
    await exportWordmark(variant);
  }
  console.log("Brand icons exported to public/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
