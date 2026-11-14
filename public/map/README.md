# Generated map data

These files are generated from [Natural Earth](https://www.naturalearthdata.com/)
(public domain) by `npm run build:places`:

- `places.json` — folded country names mapped to
  `{ name, tier, countryCode, lat, lon }`. Localized names come from
  `Intl.DisplayNames` in English, French, German, Spanish, Portuguese, and
  Italian.
- `world-110m.geojson` — compact 1:110m country outlines for the world map
  basemap.

Sources:

- `ne_50m_admin_0_countries.geojson` for country label points
- `ne_110m_admin_0_countries.geojson` for the basemap

from the
[Natural Earth vector repository](https://github.com/nvkelso/natural-earth-vector).

Do not edit these files by hand. Manual cities, subnational regions,
macro-regions, historical names, and coordinate overrides belong in
[`src/shared/placeCatalog.ts`](../../src/shared/placeCatalog.ts); they take
precedence over the generated lookup.
