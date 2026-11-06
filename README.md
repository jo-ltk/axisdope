# Alex in Present Tense

An experimental one-page site for Alex — a white, gallery-like editorial page — built with Next.js (App Router), React, TypeScript, GSAP + ScrollTrigger and a custom WebGL2 shader.

Every pixel shows the page as it was a fraction of a second ago; only the area around the pointer (or finger) is in the present. The page is ink on white paper: moving content leaves warm-grey trails and arrives pale, darkening as it develops.

## Run it

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Where things live

| Path | What it does |
| --- | --- |
| `lib/experience/config.ts` | Name, city, time zone, temperature, email and the aside line. Edit this first. |
| `lib/experience/engine.ts` | The whole experience: scenes, scroll timeline, touch and mouse input, intro, HUD updates, cleanup. |
| `lib/experience/shaders.ts` | The WebGL2 time-delay shader (trails, long exposure, flash, grain). |
| `lib/experience/products.ts` | The twelve abstract sample pieces on the opening grid (code, name, drawing). Edit, reorder or remove freely. |
| `lib/experience/piece3d.ts` | The interactive 3D object on piece pages (shapes, lighting, touch physics). |
| `lib/experience/plates.ts` | The six placeholder images, generated in the browser. |
| `lib/experience/math.ts` | Easing and noise helpers. |
| `components/Experience.tsx` | Client component: renders the markup (canvas, HUD, buttons, scroll sections) and mounts the engine. |
| `app/layout.tsx` | Fonts (self-hosted via Fontsource), metadata, viewport. |
| `app/globals.css` | Colour tokens and HUD/button styles. |

## Scenes, in scroll order

1. **Intro**: Alex's original black page, line by line. Then the name, city, time and temperature glide into a bar across the top, the aside line settles bottom-left, and the page turns white.
2. **Index**: twelve abstract forms (sphere, ring, monolith, cube…), hung like a gallery wall under "Index of forms". Select one to open its piece page. On phones the grid scrolls inside a frame.
3. **Name**: large letters that widen gently toward the pointer.
4. **Local time**: the live clock on a film strip that runs sideways with scroll (swipe on touch).
5. **Exposures**: placeholder images that fade up as they arrive.
6. **Air**: the temperature with a light heat haze and a Celsius scale.
7. **Address**: the email; click or tap to copy.

Scenes change with a short crossfade.

Section lengths (how long each scene lasts) are set in `SEC_D` (desktop) and `SEC_M` (phones) in `engine.ts`.

## Interactions

- Mouse: the area around the cursor is always sharp; hold to drag with a light long exposure.
- Touch: drag to steer, press and hold then scroll for a long exposure, swipe sideways on the time strip.
- "Smear on/off" in the corner turns the trailing effect off; it is off by default for people who ask their system for reduced motion.

## Piece pages

Selecting a piece on the index opens a simple page over the site: the object in real 3D, large on the left (on top on phones). Drag to turn it (it keeps spinning a little), press to squash it, tap to make it spin and hop; left alone it turns slowly. The 3D is a small ray-marching shader in `lib/experience/piece3d.ts` (no extra library). Beside it: code, name, a few details, an Enquire button that copies the email, and Previous / Next. Close returns to the index exactly where you were. Each page has its own link (`#piece-001` … `#piece-012`), so the browser Back button closes it and a shared link opens it directly. The details shown are in `components/Experience.tsx`; names and codes come from `products.ts`.

## Replacing the placeholder images

Each plate in `plates.ts` ends up as a canvas in `plate.cv`. To use real photos, load an `Image`, draw it into a canvas of the plate's aspect ratio, and assign it to `cv` (keep the grayscale treatment; with WebGL the canvas is read as light in the red channel, so draw the photo in grayscale into red, as `generatePlate` does).

## Notes

- The temperature is fixed at 13°C from the original page. To make it live, fetch a weather API in `Experience.tsx` and pass the value into the config before mounting.
- Phones render at a slightly lower resolution and step it down automatically if a device can't keep up; no effect is switched off.
- Without WebGL2 the page falls back to plain 2D canvas rendering (no trails).
- The engine cleans up every listener, tween, ScrollTrigger and GPU resource on unmount, so Strict Mode and client-side navigation are safe.
