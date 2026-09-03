import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDirectory = join(projectRoot, "store-assets", "source");
const imagesDirectory = join(projectRoot, "images");
const masterPath = join(sourceDirectory, "webtrace-brand-master.png");

mkdirSync(sourceDirectory, { recursive: true });
mkdirSync(imagesDirectory, { recursive: true });

execFileSync("magick", [
  "-size", "1024x1024",
  "xc:none",
  "-fill", "#315f49",
  "-stroke", "none",
  "-draw", "roundrectangle 128,128 896,896 184,184",
  "-fill", "none",
  "-stroke", "#fff4d6",
  "-strokewidth", "58",
  "-draw", "path 'M 348,710 A 250,250 0 1,1 724,348'",
  "-fill", "#fff4d6",
  "-stroke", "none",
  "-draw", "circle 348,710 377,710 circle 724,348 753,348",
  "-fill", "none",
  "-stroke", "#fff4d6",
  "-strokewidth", "58",
  "-draw", "path 'M 500,582 L 500,430'",
  "-fill", "#fff4d6",
  "-stroke", "none",
  "-draw", "circle 500,430 529,430",
  "-fill", "none",
  "-stroke", "#fff4d6",
  "-strokewidth", "62",
  "-draw", "path 'M 282,720 C 360,704 424,622 500,582 C 590,535 678,470 792,328'",
  "-fill", "#fff4d6",
  "-stroke", "none",
  "-draw", [
    "circle 282,720 340,720",
    "circle 500,582 558,582",
    "circle 792,328 850,328",
  ].join(" "),
  `PNG32:${masterPath}`,
]);

for (const size of [16, 32, 48, 128]) {
  execFileSync("magick", [
    masterPath,
    "-filter", "Lanczos",
    "-resize", `${size}x${size}`,
    `PNG32:${join(imagesDirectory, `icon_${size}.png`)}`,
  ]);
}
