const AUDIO_TYPE_ALIASES = {
  aac: "aac",
  mpeg: "mp3",
  mp3: "mp3",
  mp4: "m4a",
  "x-m4a": "m4a",
  ogg: "ogg",
  wav: "wav",
  wave: "wav",
  "x-wav": "wav",
};

export function normalizeAudioType(type) {
  const subtype = String(type || "")
    .trim()
    .toLowerCase()
    .replace(/^audio\//, "");
  return AUDIO_TYPE_ALIASES[subtype] || subtype;
}
