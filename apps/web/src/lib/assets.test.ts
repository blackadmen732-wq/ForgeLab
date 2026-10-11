import { describe, expect, it } from "vitest";
import { assetBaseUrl, parseAssetManifest } from "./assets.js";

const BASE = "https://assets.example.com";

describe("asset bucket", () => {
  it("accepts an https origin (or localhost for development) and nothing else", () => {
    expect(assetBaseUrl({})).toBeNull();
    expect(assetBaseUrl({ VITE_ASSET_BASE_URL: "https://pub-abc.r2.dev/" })).toBe(
      "https://pub-abc.r2.dev",
    );
    expect(assetBaseUrl({ VITE_ASSET_BASE_URL: "http://localhost:3000/assets" })).toBe(
      "http://localhost:3000/assets",
    );
    expect(assetBaseUrl({ VITE_ASSET_BASE_URL: "http://evil.example.com" })).toBeNull();
    expect(assetBaseUrl({ VITE_ASSET_BASE_URL: "javascript:alert(1)" })).toBeNull();
  });

  it("resolves manifest keys inside the bucket and drops anything that escapes it", () => {
    const m = parseAssetManifest(
      {
        assets: {
          "hall-hdri": { kind: "hdri", url: "hdri/plant_2k.hdr", name: "Plant", authors: ["A"] },
          sneaky: { kind: "hdri", url: "https://elsewhere.example/x.hdr" },
          climb: { kind: "hdri", url: "../secrets.hdr" },
          floor: {
            kind: "texture",
            maps: { map: "t/diff.jpg", normalMap: "t/nor.jpg", roughnessMap: "/abs.jpg" },
            tileM: 2,
          },
          broken: { kind: "texture", maps: {} },
        },
      },
      BASE,
    );
    expect(Object.keys(m.hdri)).toEqual(["hall-hdri"]);
    expect(m.hdri["hall-hdri"]!.url).toBe(`${BASE}/hdri/plant_2k.hdr`);
    expect(m.textures["floor"]).toMatchObject({
      tileM: 2,
      maps: { map: `${BASE}/t/diff.jpg`, normalMap: `${BASE}/t/nor.jpg` },
    });
    expect(m.textures["floor"]!.maps.roughnessMap).toBeUndefined();
    expect(m.textures["broken"]).toBeUndefined();
    expect(parseAssetManifest("nonsense", BASE)).toEqual({ hdri: {}, textures: {} });
  });
});
