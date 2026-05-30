import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import toIco from "to-ico";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const VARIANTS = ["dark", "light"] as const;
const PNG_SIZES = [192, 512] as const;
const FAVICON_SIZE = 32;

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

async function main() {
  for (const variant of VARIANTS) {
    await exportVariant(variant);
  }
  console.log("Brand icons exported to public/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
