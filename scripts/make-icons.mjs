// Renders public/icon.svg to the PNG app icons and a multi-size favicon.ico.
// Run after changing the SVG: node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas, Image } from "@napi-rs/canvas";

const svg = readFileSync("public/icon.svg");

function png(size) {
  const img = new Image();
  img.src = svg;
  const canvas = createCanvas(size, size);
  canvas.getContext("2d").drawImage(img, 0, 0, size, size);
  return canvas.toBuffer("image/png");
}

/** An .ico that embeds PNGs (supported by every current browser and Windows). */
function ico(sizes) {
  const images = sizes.map((s) => ({ size: s, data: png(s) }));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    header.writeUInt8(0, e + 2); // palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
writeFileSync("public/favicon.ico", ico([16, 32, 48]));
console.log("icons written");
