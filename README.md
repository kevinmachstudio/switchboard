# Switchboard

A pocket-sized fidget panel with eight tactile controls. The app uses vanilla HTML, CSS, and JavaScript. It keeps control positions and the mute setting on the current device.

## Run locally

From the repository root, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8000/. After the service worker has cached the panel, it can reopen offline. The in-app Install button appears when the browser offers installation. On iOS, use **Share → Add to Home Screen**.

With a keyboard, use Tab to focus a control, Space or Enter to press it, and the arrow keys to move the dial, slider, wheel, or rocker. On the slider, Home and End go to the bottom and top.

## Deploy over HTTPS

- **Netlify** — Import this repository and use the checked-in `netlify.toml` to publish `dist` without a build command. You can also run `netlify deploy --prod --dir=dist` from a linked project.
- **GitHub Pages** — Push to a GitHub repository, select **GitHub Actions** under **Settings → Pages → Build and deployment**, then run the checked-in workflow or push to `main`. Use the HTTPS URL shown under Pages.

For a release that changes any offline asset, increment the cache version in `dist/sw.js` so the next service worker precaches the new files.
