import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import toIco from "to-ico";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const VARIANTS = ["dark", "light"] as const;
const PNG_SIZES = [192, 512] as const;
const FAVICON_SIZE = 32;
/** Wordmark SVG viewBox width × height (see public/logo-wordmark-*.svg). */
const WORDMARK_VIEWBOX_WIDTH = 168;
const WORDMARK_EXPORT_WIDTH = WORDMARK_VIEWBOX_WIDTH * 3;

async function exportVariant(variant: (typeof VARIANTS)[number]) {
  const svgPath = path.join(PUBLIC_DIR, `logo-${variant}.svg`);
  const svgBuffer = await fs.readFile(svgPath);

  for (const size of PNG_SIZES) {
    const outputPath = path.join(PUBLIC_DIR, `logo-${variant}-${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outputPath);
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
