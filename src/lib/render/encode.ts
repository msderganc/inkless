import { type EncodedImage, ImageEncoder, type ImageSource, PageColorType } from "@mmote/niimbluelib";
import { PRINTHEAD_DOTS } from "../geometry";
import { type MonoBitmap } from "./mono";

class MonoSource implements ImageSource {
  constructor(private readonly bmp: MonoBitmap) {}
  get width() {
    return this.bmp.width;
  }
  get height() {
    return this.bmp.height;
  }
  getPixelColor(x: number, y: number): number {
    if (x >= this.bmp.width || y >= this.bmp.height) return 0xffffff;
    return this.bmp.data[y * this.bmp.width + x] ? 0x000000 : 0xffffff;
  }
}

/** Encode a print raster for the B21S (`printDirection: "top"`, single colour). */
export function encodeForPrinter(bmp: MonoBitmap): EncodedImage {
  if (bmp.width > PRINTHEAD_DOTS) {
    throw new RangeError(`Raster is ${bmp.width} dots wide; the printhead is ${PRINTHEAD_DOTS}`);
  }
  if (bmp.height < 1) throw new RangeError("Raster is empty");
  return ImageEncoder.encode(new MonoSource(bmp), PageColorType.SingleColor, "top");
}
