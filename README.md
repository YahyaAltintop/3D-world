# 🌍 3D World Atlas

An interactive 3D globe built with Vue 3 + Three.js that you can freely
explore. Country borders (~177 countries) are drawn on the globe; the names
of countries facing the camera appear as labels. The globe slowly auto-rotates
when idle. The UI supports Turkish and English: the browser's language is used
on first load, and can be switched with the TR/EN buttons in the top right.

## Controls

| Action | How |
| --- | --- |
| Rotate the globe | Click/touch and drag (arrow keys also work) |
| Zoom in / out | Mouse wheel, pinch gesture, or ＋/－ buttons |
| Country info | Click a country → card with flag, name, capital, population, and area; the country fill is painted with its flag's dominant color |
| Name tooltip | Hover over a country |
| Dismiss selection | Click the ocean or press `ESC` |
| Reset view | ⟲ button |
| Change language | TR / EN buttons in the top right |

## Running

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser (Vite will pick another port
if that one is busy).

For a production build:

```bash
npm run build
npm run preview
```

## Deployment (Firebase Hosting)

The site is hosted on Firebase Hosting. Every push to the `main` branch is
automatically deployed via the
[GitHub Actions workflow](.github/workflows/deploy.yml).

To deploy to your own Firebase project, add the following secrets to the repo
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g. `my-project-1234`) |
| `FIREBASE_SERVICE_ACCOUNT` | The full JSON content of a service account key authorized to deploy |

To obtain a service account key:

1. In [Google Cloud Console → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts),
   select your Firebase project and create a new service account.
2. Grant it the **Firebase Hosting Admin** role.
3. Under the account's **Keys** tab, generate a JSON key and paste the entire
   file contents into the `FIREBASE_SERVICE_ACCOUNT` secret.

> Shortcut: Running `firebase init hosting:github` will create the service
> account and secret for you. You can delete the workflow files it generates
> and use the one in this repo; just re-add the generated secret value under
> the name `FIREBASE_SERVICE_ACCOUNT` (so the project ID isn't embedded in
> the secret name).

### Manual (local) deploy

The project ID is not stored in the repo — `.firebaserc` is gitignored.
Copy [.firebaserc.example](.firebaserc.example) to `.firebaserc`, fill in
your project ID, then run:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## How it works

- **Map data:** Natural Earth country borders (TopoJSON) from the
  [`world-atlas`](https://www.npmjs.com/package/world-atlas) package are
  converted to GeoJSON via `topojson-client` and placed on the globe as line
  geometry.
- **Language support (tr/en):** [`src/lib/i18n.js`](src/lib/i18n.js) —
  the browser language is used on first load (falls back to English if not
  Turkish); manual selections are persisted in `localStorage`. The page title
  and `<html lang>` attribute are also updated when the language changes.
- **Country names:** Generated automatically from ISO country codes in the
  active language using the browser's `Intl.DisplayNames` API (`i18n-iso-countries`
  handles numeric code → alpha-2 conversion). Capitals in both languages are in
  [`src/data/capitals.js`](src/data/capitals.js); populations are in
  [`src/data/populations.js`](src/data/populations.js).
- **Flags:** Loaded from [flagcdn.com](https://flagcdn.com) by alpha-2 code
  (the card is shown without a flag if offline). The selected country's border
  color is the dominant vivid color extracted from the flag image
  ([`src/lib/flagColor.js`](src/lib/flagColor.js)); falls back to gold if
  extraction fails.
- **Population & area:** Stored statically in
  [`src/data/populations.js`](src/data/populations.js) and
  [`src/data/areas.js`](src/data/areas.js).
- **Click detection:** A raycasted point on the globe is converted to
  latitude/longitude, then an even-odd point-in-polygon test determines which
  country's borders contain it.
- **Selection fill:** The selected country's polygons are triangulated in
  [`src/lib/fill.js`](src/lib/fill.js) (earcut; holes are preserved,
  antimeridian-crossing rings are unwound), subdivided to conform to the globe
  surface, and painted with the flag's dominant color.

## Customization

- Colors are controlled by the `BASE_LINE` / `HI_LINE` constants at the top of
  `src/components/GlobeCanvas.vue`; zoom limits via `ZOOM_MIN` / `ZOOM_MAX`;
  initial camera position via `HOME`.
- To add or correct capitals, edit `src/data/capitals.js` (ISO numeric code →
  name).
