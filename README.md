# Sort Sol 🐦‍⬛

Guide a **sort sol** — the iconic Danish "black sun" of swirling starlings — through
the dusk over the marsh. Steer with one finger; keep the flock **together** and it
protects itself. Let birds straggle and the **vandrefalk** (peregrine falcon) picks
them off, one at a time, for good.

Live: https://bordingcode.github.io/sort-sol/

## How it plays
- **Drag** to lead the flock. The whole murmuration follows.
- The falcon **locks** the loneliest bird (a red line warns you), then **dives**.
  A tight flock confuses it; a sharp **swerve** makes it overshoot. React in time.
- Fly over **lone starlings** to gather them and grow your sort sol.
- **Raststeder** (roosts) give a calm breather and a bonus; the falcons multiply and
  press harder the longer you last.
- One life. Lose every bird and it's over — best score is saved.

## Tech
Vanilla HTML/CSS/JS, no build. Canvas with a fixed-timestep sim:
- **Boids** flocking (separation/alignment/cohesion + lead + fear) over a spatial hash.
- A turn-limited **peregrine** stoop AI (homes, but can't turn sharply at speed — so a
  swerve beats it).
- Generative **Web Audio**: a soft pentatonic evening pad that swells with danger, plus
  wing-whoosh, screech, roost chime and a mournful note per bird lost.
- PWA (installable, offline) with a network-first service worker.

## Local
```
python3 -m http.server 8756   # then open http://127.0.0.1:8756
```
After editing, bump `CACHE` in `sw.js` and the `?v=` on the `<link>/<script>` tags.
