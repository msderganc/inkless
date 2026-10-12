import {
  AbstractPrintTask,
  type EncodedImage,
  PacketGenerator,
} from "@mmote/niimbluelib";

/**
 * B21S print sequence. NiimBlueLib's D110 task sends a 4-byte SetPageSize (rows + cols), which on
 * Matthew's B21S (firmware 40.33) feeds a blank label even though every packet is acknowledged.
 * Thermalith's hardware-verified D110-family sequence sends the 2-byte form (rows only); the
 * printer then assumes the full 384-dot head width, so pages must be head-width rasters
 * (see positionOnHead).
 */
export class B21SPrintTask extends AbstractPrintTask {
  override printInit(): Promise<void> {
    return this.protocol.sendAll([
      PacketGenerator.setDensity(this.printOptions.density),
      PacketGenerator.setLabelType(this.printOptions.labelType),
      PacketGenerator.printStart1b(),
    ]);
  }

  override printPage(image: EncodedImage, quantity?: number): Promise<void> {
    this.validatePage(image, quantity ?? 1);
    return this.protocol.sendAll(
      [
        PacketGenerator.printClear(),
        PacketGenerator.pageStart(),
        PacketGenerator.setPageSize2b(image.rows),
        PacketGenerator.setPrintQuantity(quantity ?? 1),
        ...PacketGenerator.writeImageData(image, {
          printheadPixels: this.printheadPixels(),
        }),
        PacketGenerator.pageEnd(),
      ],
      this.printOptions.pageTimeoutMs,
      this.makePacketProgressCallback(),
    );
  }

  override waitForPageFinished(): Promise<void> {
    this.protocol.setPacketTimeout(this.printOptions.statusTimeoutMs);
    return this.protocol
      .waitUntilPrintFinishedByStatusPoll(
        this.pagesPrinted,
        this.printOptions.statusPollIntervalMs,
      )
      .finally(() => this.protocol.setDefaultPacketTimeout());
  }

  override waitForFinished(): Promise<void> {
    return this.waitForPageFinished();
  }
}
