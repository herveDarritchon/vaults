---
title: Battlemaps
image: mossfoot-great-hall.webp
---

A built-in `battlemap` code-block handler renders a layered, multi-level map with a level switcher, a grid-overlay toggle, and a PNG download of whatever is currently composited. Use it for maps with floors, or for a before/after state you want to flip between at the table.

## Live demo

The same room as the Foundry [[Mossfoot Great Hall]] scene, on the same 140px grid, with the feast as a second level. Switch levels, toggle the grid, download the composite:

```battlemap
grid: 140
default_level: 0
name: Mossfoot Great Hall
levels:
  - name: Empty Hall
    layers:
      - "attachments/mossfoot-great-hall.webp"
  - name: Feast Laid
    layers:
      - "attachments/mossfoot-great-hall-feast.webp"
```

## Levels and layers

- Each **level** is one button in the switcher.
- A level's **layers** composite bottom-to-top, so a floor plan typically repeats the levels beneath it and adds its own storey on top.
- Layer paths are **vault-relative** (not basenames), which keeps identically-named exports in different map folders apart.
- The build stages every layer it finds in a `battlemap` block, so a purely web-side overlay that nothing else references still ships with the deploy. Layers follow the same per-variant role gating as any other image.

## Fields

| Field | Notes |
|---|---|
| `levels` | Required. List of `{ name, layers }`. A level with no layers is dropped. |
| `grid` | Pixels per grid cell **at the image's native size**. Omit for no grid overlay. |
| `grid_offset_x`, `grid_offset_y` | Shift the overlay right/down, in native-size pixels. Default `0`. |
| `default_level` | 0-based index of the level shown first. Out-of-range values fall back to `0`. |
| `name` | Prefix for the downloaded PNG's filename. |

An unparseable block renders a visible error box instead of failing the build.
