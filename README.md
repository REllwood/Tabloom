<div align="center">

# Tabloom

**Weave a crowded browser window into a small, explainable research map.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

Research leaves you with a window full of tabs you're scared to close. Tabloom groups them into a small map of clusters, tells you in plain language why each tab landed where it did, and lets you rename clusters, add notes and export the whole thing as an outline.

## What it does

- Imports a set of tabs you pick, and shows every captured field before using it
- Groups tabs into clusters the same way every time, with a plain-language reason for each
- Keeps your cluster names and notes in the browser
- Switches between a map view and a full outline
- Exports Markdown, JSON or a self-contained HTML page, with query strings stripped by default

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/tabloom.git
cd tabloom
npm start
```

Open http://127.0.0.1:4174 and press **Use synthetic fixture** to load a sample research session.

## Status

v0.1 imports a list of tabs rather than reading your browser directly. Next up is a browser extension that captures the tabs for you, then Firefox support and citation details.

## Development

```sh
npm test        # clustering and export tests
npm run check   # tests plus syntax checks
```

## License

[MIT](LICENSE)
