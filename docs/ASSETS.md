# 3D assets: photographic HDRIs and textures on Cloudflare R2

ForgeLab draws everything procedurally, so it always works with no assets at all. When
the deployment points at an **asset bucket**, it also loads photographic, CC0-licensed
assets from there:

| Slot        | Asset (Poly Haven, CC0)                                                                                | Used for                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `hall-hdri` | [Peppermint Powerplant](https://polyhaven.com/a/peppermint_powerplant) by Andreas Mischok, 2k HDR      | What metal reflects in the reactor hall    |
| `floor`     | [Metal Plate 02](https://polyhaven.com/a/metal_plate_02) by Rob Tuytel, 2k (colour, normal, roughness) | The hall's welded steel deck, tiled at 2 m |

Presentation only: assets change how things look, never what they are or how they
behave. While they load, or if the bucket is unreachable, the procedural look stays.
The list lives in `scripts/assets/catalog.mjs`; swap an asset by changing its Poly Haven id.

## One-time setup

1. **Create the bucket.** Cloudflare dashboard → R2 → Create bucket (e.g. `forgelab-assets`).
2. **Make it publicly readable.** Bucket → Settings → Public access: connect a custom
   domain (recommended, e.g. `assets.your-domain.com`), or enable the `r2.dev` URL for
   testing. The app only ever reads from it.
3. **Allow the site to read textures (CORS).** Bucket → Settings → CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-forgelab-domain.com", "http://localhost:5173"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

4. **Create an API token** that can edit this bucket (R2 → Manage API tokens → Object
   Read & Write, limited to the bucket). Keep it on your machine or in CI secrets only.

## Fetch and upload

```sh
node scripts/assets/fetch-polyhaven.mjs        # downloads into assets-dist/, checks md5s
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… R2_BUCKET=forgelab-assets \
  node scripts/assets/upload-r2.mjs            # uploads with Cloudflare's wrangler CLI
```

`assets-dist/` is not committed. Files are cached for a year; `manifest.json` for five
minutes, so swapping an asset shows up quickly.

## Point the site at it

In Vercel → Settings → Environment Variables set `VITE_ASSET_BASE_URL` to the bucket's
public origin (e.g. `https://assets.your-domain.com`) and redeploy. The build adds that
origin to the Content-Security-Policy (`img-src`, `connect-src`). Only `https` origins
(or `localhost` in development) are accepted, and manifest paths must stay inside the
bucket.

## Making more realistic 3D: tools worth knowing

- **[Poly Haven](https://polyhaven.com)** and **[ambientCG](https://ambientcg.com)**:
  CC0 HDRIs, PBR textures and models (the source used above).
- **[TRELLIS.2](https://github.com/microsoft/TRELLIS.2)** (Microsoft, MIT license):
  single image → textured 3D model (GLB with PBR materials). Needs an NVIDIA GPU (about
  24 GB is comfortable). Good for drafting machine shells to refine in Blender.
- **Blender**: final modelling, UVs and baking; export glTF/GLB.
- **[glTF-Transform](https://gltf-transform.dev)**: optimise GLBs for the web
  (meshopt geometry, KTX2/WebP textures) before uploading them to the bucket.
- **[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)**: offline,
  path-traced stills of a design (too heavy for live play).

ForgeLab's live renderer already uses three.js's ground-truth ambient occlusion (GTAO,
HIGH and ULTRA), a mirror floor, image-based lighting and procedural wear. Imported
machine models are not wired in yet: a model must fit the part's physical envelope, and its
internals must stay labelled SCHEMATIC (CLAUDE.md §21).
