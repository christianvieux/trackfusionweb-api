import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

jest.mock("mime", () => ({ getType: jest.fn() }));

import {
  imageService,
  TRACK_ARTWORK_MAX_DIMENSION,
} from "./imageService.js";

let tempDirectory;

beforeEach(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "track-artwork-test-"));
});

afterEach(async () => {
  await fs.rm(tempDirectory, { recursive: true, force: true });
});

test("normalizes track artwork to a bounded WebP", async () => {
  const inputPath = path.join(tempDirectory, "cover.png");
  const outputPath = path.join(tempDirectory, "cover.webp");
  await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 4,
      background: { r: 40, g: 90, b: 180, alpha: 0.8 },
    },
  })
    .png()
    .toFile(inputPath);

  const result = await imageService.processForTrackArtwork(inputPath, outputPath);
  const metadata = await sharp(outputPath).metadata();

  expect(result).toEqual(
    expect.objectContaining({ success: true, format: "webp" }),
  );
  expect(metadata.format).toBe("webp");
  expect(metadata.width).toBeLessThanOrEqual(TRACK_ARTWORK_MAX_DIMENSION);
  expect(metadata.height).toBeLessThanOrEqual(TRACK_ARTWORK_MAX_DIMENSION);
  expect((await fs.stat(outputPath)).size).toBeGreaterThan(0);
});

test("does not enlarge artwork that is already within the bound", async () => {
  const inputPath = path.join(tempDirectory, "small.jpg");
  const outputPath = path.join(tempDirectory, "small.webp");
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 30, g: 30, b: 30 },
    },
  })
    .jpeg()
    .toFile(inputPath);

  await imageService.processForTrackArtwork(inputPath, outputPath);
  const metadata = await sharp(outputPath).metadata();

  expect(metadata.width).toBe(640);
  expect(metadata.height).toBe(480);
});
