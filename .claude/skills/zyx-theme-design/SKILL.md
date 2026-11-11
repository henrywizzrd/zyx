---
name: zyx-theme-design
description: Design and add a new color theme (bộ màu) with an animated background scene to the ZYX app — palette, Skia/SkSL shader sky or particle effect, studio preview, strings, performance rules. Use when creating, restyling or debugging a ZYX theme or ambient background effect.
---

# ZYX theme design

How a ZYX theme is built, so every new theme follows the same standard. Read this before touching `src/theme/`.

## 1. Where a theme lives (checklist — miss one and the theme is half-wired)

| What | File | Note |
|---|---|---|
| Preset id | `src/theme/presets.ts` → `ThemePresetId` | |
| Has a background effect? | same file → `AmbientPresetId` + `AMBIENT_PRESETS` | |
| Palette | same file → `PRESETS[id]` (`Palette`) | all 14 fields |
| Order in picker | same file → `PRESET_ORDER` | group with similar themes |
| Effect on by default | `src/theme/defaultTheme.ts` → `effects.ambient` | |
| Theme-switch transition | `src/theme/ThemeTransition.tsx` → `EFFECT_OF` | dark themes use `'ink'` |
| Still scene (always drawn) | `src/theme/effects/Ambient.tsx` → `ThemeScene` | drawn once |
| Live effect | same file → `pickEffect` | paused while Player is open / app in background |
| Studio thumbnail | `src/screens/ThemeStudioScreen.tsx` → `MiniScreen` | a few `View`s, no Skia |
| Names | `src/i18n/strings.ts` → `preset.<id>`, `studio.ambient.<id>` | add to both the vi and en blocks |

## 2. Palette rules

- `bg` = the darkest/most common color of the scene, so the first frame (before Skia draws) matches.
- `text` on `bg` ≥ 7:1 contrast; `textSecondary` ≥ 4.5:1.
- `accent` is taken from the brightest element of the scene (star light, aurora, petal), slightly desaturated.
- `glassRgb` = `bg` lifted ~5–10% toward `surface`; `glassTint` follows the scene's lightness.
- One accent only. No second highlight color.

## 3. Background scenes: how to make them look good

Prefer **one full-screen SkSL shader** (see `src/theme/effects/starry.ts`) for skies, nebulae, gradients and noise; use **Skia Picture particles** (see `MeteorShower`, `SakuraPetals`) for discrete objects that move independently (petals, fish, meteors).

Shader recipe that works (Trời sao):
- Base: radial glow in one corner + vertical darkening → never a flat color.
- Texture: fbm noise (4–5 octaves) for clouds/nebulae, masked to a region (e.g. a diagonal band), plus a darker fbm "dust" layer multiplied in.
- Stars/particles in a cell grid: each cell has at most one item, decided by a hash. 2–3 layers (far = small/dense/slow, near = big/sparse/faster) for depth.
- Brightness distribution `pow(hash, 5)`: most items dim, a few bright. Uniform brightness looks fake.
- Soft shapes: `exp(-d²/σ²)` core + wider faint halo. Never hard discs or thin crosses on every star; spikes only on the brightest few.
- Slight color temperature variety (blue-white, a few warm).
- Soft tone-map `1 - exp(-col * k)` and ±0.5/255 dither to kill banding.

Known GPU pitfalls (both happened):
1. `smoothstep(a, b, x)` with `a > b` is undefined on GPU → artifacts. Write `1.0 - smoothstep(b, a, x)`.
2. Anything that decides whether a grid item exists must be computed from the **cell**, not the pixel; otherwise neighbouring items get sliced along a line. Also fade every item to 0 before the edge of the neighbourhood you loop over.

## 4. Performance budget

- Live effects run on the UI thread only (Reanimated frame callback + Skia). Never `setState` per frame.
- Use `useAmbientClock(true)` (30 fps) for slow motion (skies, aurora); 60 fps clock only for falling particles.
- Full-screen shaders: keep per-pixel work small — loop 3×3 neighbours only for layers whose glow crosses cells; the far layer checks only its own cell.
- The still scene must render without the live layer (effect switched off, Player open): draw the same shader with `time = 0`, no twinkle.
- Respect reduced motion (Theme studio switch) — still scene only.
- Test on the Galaxy A51 (weak Mali GPU) as well as the iPhone.

## 5. Workflow

1. Prototype on the web first (WebGL page, same math) and publish it as an artifact so Tyson can pick a variant and tune sliders.
2. Port to SkSL: `vec*` → `float*`, `main(float2 pos)` returns `half4`, y axis points **down**, no `continue`.
3. Verify the SkSL compiles and looks right before pushing: render it with CanvasKit in Node (`node_modules/canvaskit-wasm`, `CK.RuntimeEffect.Make(src, onError)`, then `makeShader` → PNG).
4. Run the normal checks (`tsc`, `bt.js`, `jsxtext.js`, `wcheck.js`, `expo export` ios + android), then ship with `[update]`.

## 6. Free references (check the license before copying code; ideas are free)

- Godot Shaders (godotshaders.com): starry sky, animated starfield, deep space — GLSL, easy to port.
- shadcn.io shaders (nebula, starry planes) — web previews.
- Aceternity UI: shooting stars & stars background, glowing stars (React, layout/motion ideas).
- 21st.dev: galaxy starfield, nebula space background, deep sky canvas.
- tsParticles presets (stars, meteors) — MIT.
- Many Shadertoy / Godot shaders are CC BY-NC (no commercial use): re-implement, don't paste. Credit sources in a comment.
