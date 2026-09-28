# 🌍 3D World Atlas

An interactive 3D globe built with Vue 3 and Three.js. Drag to rotate, zoom in,
and click a country: its flag is painted inside its borders and a card shows
its capital, population and area. Available in Turkish and English.

**Live:** https://3dworld.web.app

## Run locally

```bash
npm install
npm run dev
```

For a production build, run `npm run build`. The output goes to `dist/`.

## Deploy

Every push to `main` is deployed to Firebase Hosting by
[GitHub Actions](.github/workflows/deploy.yml). The workflow needs two
repository secrets:

| Secret | Value |
| --- | --- |
| `VITE_FIREBASE_PROJECT_ID` | Your Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT` | JSON key of a service account with the **Firebase Hosting Admin** role |

## Data

- Country borders: [Natural Earth](https://www.naturalearthdata.com/) via [`world-atlas`](https://www.npmjs.com/package/world-atlas)
- Flags: [flagcdn.com](https://flagcdn.com)
- Capitals, population and area: [`src/data/`](src/data/)

## License

[MIT](LICENSE)
