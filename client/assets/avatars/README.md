# GLB Avatar Assets

Drop stylized cowboy avatar models here to replace the procedural avatars.

Supported files (checked in this order):

- `seat1.glb`
- `seat2.glb`
- `seat3.glb`
- `seat4.glb`
- `cowboy.glb` (shared fallback used for any seat missing a seat-specific file)

Notes:
- The client auto-loads these at runtime from `/assets/avatars/...`
- If a GLB contains an animation named like `sit`, `seated`, or `idle`, the client will try to play it
- Models are auto-scaled and positioned for a seated chair slot, but you may still want to author them in a seated pose for best results
- Textures referenced by the GLB should live next to the GLB or in paths preserved by the export
