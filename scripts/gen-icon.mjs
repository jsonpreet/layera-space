import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "scripts/icon-src.svg"));
const out = join(root, "scripts/icon-src.png");

await sharp(svg, { density: 300 })
  .resize(1024, 1024)
  .png()
  .toFile(out);

console.log("wrote", out);
