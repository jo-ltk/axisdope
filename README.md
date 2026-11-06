# Alex in Present Tense

An experimental one-page site for Alex, built with Next.js (App Router), React, TypeScript, GSAP + ScrollTrigger and a custom WebGL2 shader.

Every pixel shows the page as it was a fraction of a second ago; only the area around the pointer (or finger) is in the present. Moving content leaves ember trails behind and arrives in ice blue.

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
| `lib/experience/config.ts` | Name, city, time zone, temperature, email, coordinates. Edit this first. |
| `lib/experience/engine.ts` | The whole experience: scenes, scroll timeline, touch and mouse input, intro, HUD updates, cleanup. |
| `lib/experience/shaders.ts` | The WebGL2 time-delay shader (trails, long exposure, flash, grain). |
| `lib/experience/plates.ts` | The six placeholder images, generated in the browser. |
| `lib/experience/math.ts` | Easing and noise helpers. |
| `components/Experience.tsx` | Client component: renders the markup (canvas, HUD, buttons, scroll sections) and mounts the engine. |
| `app/layout.tsx` | Fonts (self-hosted via Fontsource), metadata, viewport. |
| `app/globals.css` | Colour tokens and HUD/button styles. |

## Scenes, in scroll order

1. **Intro**: the original plain page is scanned into the new one.
2. **Name**: giant letters that widen toward the pointer and stretch upward on scroll.
3. **Local time**: the live clock on a film strip that runs sideways with scroll (swipe on touch).
4. **Exposures**: placeholder images that assemble from slices.
5. **The slit**: a photo-finish recording of the name; scroll speed squashes it, scrolling back mirrors it.
6. **Air**: the temperature with heat haze and a Celsius scale.
7. **Address**: the email, revealed by the scan; click or tap to copy.

Section lengths (how long each scene lasts) are set in `SEC_D` (desktop) and `SEC_M` (phones) in `engine.ts`.

## Interactions

- Mouse: move to steer the present, hold to drag with a long exposure, double-click to flash.
- Touch: drag to steer (it wanders on its own when idle), press and hold then scroll for a long exposure, swipe sideways on the time strip and the slit, double-tap to flash.
- "Smear on/off" in the corner turns the trailing effect off; it is off by default for people who ask their system for reduced motion.

## Replacing the placeholder images

Each plate in `plates.ts` ends up as a canvas in `plate.cv`. To use real photos, load an `Image`, draw it into a canvas of the plate's aspect ratio, and assign it to `cv` (keep the grayscale treatment; with WebGL the canvas is read as light in the red channel, so draw the photo in grayscale into red, as `generatePlate` does).

## Notes

- The temperature is fixed at 13°C from the original page. To make it live, fetch a weather API in `Experience.tsx` and pass the value into the config before mounting.
- Phones render at a slightly lower resolution and step it down automatically if a device can't keep up; no effect is switched off.
- Without WebGL2 the page falls back to plain 2D canvas rendering (no trails).
- The engine cleans up every listener, tween, ScrollTrigger and GPU resource on unmount, so Strict Mode and client-side navigation are safe.
