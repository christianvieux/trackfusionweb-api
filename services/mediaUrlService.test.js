const mockGenerateSecureUrl = jest.fn();

jest.mock("./s3Service.js", () => ({
  s3Service: {
    generateSecureUrl: (...args) => mockGenerateSecureUrl(...args),
  },
}));

import {
  authorizeMediaReference,
  authorizeTrackArtwork,
} from "./mediaUrlService.js";

beforeEach(() => {
  jest.clearAllMocks();
});

test("resolves a stored cover key through the configured storage signer", async () => {
  const signedUrl =
    "http://127.0.0.1:9000/bucket/covers/36/cover.webp?X-Amz-Signature=abc";
  mockGenerateSecureUrl.mockResolvedValue(signedUrl);

  await expect(
    authorizeMediaReference("covers/36/30-cover.webp"),
  ).resolves.toBe(signedUrl);
  expect(mockGenerateSecureUrl).toHaveBeenCalledWith(
    "covers/36/30-cover.webp",
    3600,
  );
});

test("authorizes artwork without mutating the source track", async () => {
  const track = { id: 30, image_url: "covers/36/30-cover.webp" };
  mockGenerateSecureUrl.mockResolvedValue("https://media.example/signed-cover");

  await expect(authorizeTrackArtwork(track)).resolves.toEqual({
    ...track,
    image_url: "https://media.example/signed-cover",
  });
  expect(track.image_url).toBe("covers/36/30-cover.webp");
});

test("leaves missing artwork untouched and does not call storage", async () => {
  const track = { id: 30, image_url: null };

  await expect(authorizeTrackArtwork(track)).resolves.toBe(track);
  expect(mockGenerateSecureUrl).not.toHaveBeenCalled();
});
