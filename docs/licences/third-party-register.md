# Third-party dependency and licence register

Required by the project licensing policy and by ADR 0007. The application
is licensed GPL-3.0-or-later; every entry here must be inbound-compatible
with that.

Generated 2026-11-05 from a clean install of the full
dependency set on Node 26.13.0. Packages examined: **369**.

Regenerate whenever dependencies change. See
`.kiro/steering/licensing.md` for the procedure and the rules.

## Compatibility summary

| Verdict | Count |
| --- | --- |
| Compatible with GPL-3.0 | 369 |

No package in the tree is incompatible with GPL-3.0, and none requires a
further decision.

## Licence distribution

| Licence | Packages |
| --- | --- |
| MIT | 293 |
| ISC | 26 |
| Apache-2.0 | 15 |
| BSD-3-Clause | 11 |
| BSD-2-Clause | 7 |
| BlueOak-1.0.0 | 6 |
| MPL-2.0 | 2 |
| (MIT AND Zlib) | 1 |
| (MIT OR CC0-1.0) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (WTFPL OR MIT) | 1 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |
| Python-2.0 | 1 |
| WTFPL | 1 |
| WTFPL OR ISC | 1 |

## Shipped in the application bundle

These are distributed to users, so their licences bind the combined work.

| Package | Version | Licence | GPL-3.0 compatible |
| --- | --- | --- | --- |
| `@tmcw/togeojson` | 7.1.3 | BSD-2-Clause | Yes |
| `better-sqlite3` | 13.0.3 | MIT | Yes |
| `drizzle-orm` | 0.45.4 | Apache-2.0 | Yes |
| `electron` | 45.2.3 | MIT | Yes |
| `fast-xml-parser` | 5.12.0 | MIT | Yes |
| `fit-file-parser` | 6.2.7 | MIT | Yes |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) | Yes |
| `leaflet` | 1.9.4 | BSD-2-Clause | Yes |
| `react` | 19.3.1 | MIT | Yes |
| `react-dom` | 19.3.1 | MIT | Yes |
| `zod` | 4.6.7 | MIT | Yes |
| `zustand` | 5.0.16 | MIT | Yes |

Chromium and Node.js reach users via Electron. Electron is MIT; Chromium is
BSD-3-Clause with LGPL components; Node.js is MIT. All are compatible, and
Electron ships its own notices which must be reproduced in the About window.

## Build and development only

Not distributed, so these do not bind the combined work. Recorded for
completeness and to catch anything that would restrict contribution.

| Package | Version | Licence | GPL-3.0 compatible |
| --- | --- | --- | --- |
| `@electron/rebuild` | 4.2.1 | MIT | Yes |
| `@tailwindcss/vite` | 4.3.4 | MIT | Yes |
| `@vitejs/plugin-react` | 6.2.1 | MIT | Yes |
| `@vitest/coverage-v8` | 5.1.0 | MIT | Yes |
| `drizzle-kit` | 0.31.11 | MIT | Yes |
| `electron-builder` | 26.18.0 | MIT | Yes |
| `electron-vite` | 6.0.0 | MIT | Yes |
| `oxlint` | 1.91.0 | MIT | Yes |
| `playwright` | 1.65.0 | Apache-2.0 | Yes |
| `tailwindcss` | 4.3.4 | MIT | Yes |
| `typescript` | 7.0.2 | Apache-2.0 | Yes |
| `vite` | 8.3.6 | MIT | Yes |
| `vitest` | 5.1.0 | MIT | Yes |

## Rejected on licence grounds

| Package | Licence | Reason | Replacement |
| --- | --- | --- | --- |
| `react-leaflet` | Hippocratic-2.1 | Use restrictions and indemnity obligation are further restrictions GPL-3.0 §7 forbids; not OSI-approved | Leaflet used directly, ADR 0008 |
| `@react-leaflet/core` | Hippocratic-2.1 | As above, transitive dependency of the above | — |
| `@garmin/fitsdk` | Proprietary FIT Protocol License Agreement | Bilateral EULA requiring acceptance; not open source, cannot combine with GPL-3.0 | `fit-file-parser` (MIT), ADR 0006 |
| GPSBabel (bundling) | GPL-2.0-or-later | Not rejected. Compatible with GPL-3.0 and now permitted; retained here as a note that it was previously excluded under ADR 0006 | — |

## Full dependency list

<details>
<summary>All 369 packages</summary>

| Package | Version | Licence |
| --- | --- | --- |
| `@babel/code-frame` | 7.29.7 | MIT |
| `@babel/compat-data` | 7.29.7 | MIT |
| `@babel/core` | 7.29.13 | MIT |
| `@babel/generator` | 7.29.13 | MIT |
| `@babel/helper-compilation-targets` | 7.29.13 | MIT |
| `@babel/helper-globals` | 7.29.7 | MIT |
| `@babel/helper-module-imports` | 7.29.7 | MIT |
| `@babel/helper-module-transforms` | 7.29.13 | MIT |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT |
| `@babel/helper-string-parser` | 7.29.13 | MIT |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT |
| `@babel/helper-validator-option` | 7.29.7 | MIT |
| `@babel/helpers` | 7.29.13 | MIT |
| `@babel/parser` | 7.29.13 | MIT |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT |
| `@babel/template` | 7.29.7 | MIT |
| `@babel/traverse` | 7.29.13 | MIT |
| `@babel/types` | 7.29.11 | MIT |
| `@bcoe/v8-coverage` | 1.0.2 | MIT |
| `@drizzle-team/brocli` | 0.10.2 | Apache-2.0 |
| `@electron-internal/extract-zip` | 1.0.8 | MIT |
| `@electron/asar` | 3.4.1 | MIT |
| `@electron/fuses` | 1.8.0 | MIT |
| `@electron/get` | 3.1.0 | MIT |
| `@electron/notarize` | 2.5.0 | MIT |
| `@electron/osx-sign` | 1.3.3 | BSD-2-Clause |
| `@electron/rebuild` | 4.2.1 | MIT |
| `@electron/universal` | 2.0.3 | MIT |
| `@electron/windows-sign` | 1.2.2 | BSD-2-Clause |
| `@emnapi/core` | 1.11.3 | MIT |
| `@emnapi/runtime` | 1.11.3 | MIT |
| `@emnapi/wasi-threads` | 1.2.3 | MIT |
| `@esbuild-kit/core-utils` | 3.3.2 | MIT |
| `@esbuild-kit/esm-loader` | 2.6.5 | MIT |
| `@esbuild/darwin-arm64` | 0.25.12 | MIT |
| `@isaacs/fs-minipass` | 4.0.1 | ISC |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT |
| `@jridgewell/remapping` | 2.3.5 | MIT |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT |
| `@jridgewell/sourcemap-codec` | 1.6.0 | MIT |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT |
| `@malept/cross-spawn-promise` | 2.0.0 | Apache-2.0 |
| `@malept/flatpak-bundler` | 0.4.0 | MIT |
| `@napi-rs/wasm-runtime` | 1.2.2 | MIT |
| `@noble/hashes` | 1.8.0 | MIT |
| `@nodable/entities` | 3.1.0 | MIT |
| `@oxc-project/types` | 0.156.0 | MIT |
| `@oxlint/binding-darwin-arm64` | 1.91.0 | MIT |
| `@peculiar/asn1-schema` | 2.11.1 | MIT |
| `@peculiar/json-schema` | 1.1.12 | MIT |
| `@peculiar/utils` | 2.0.3 | MIT |
| `@peculiar/webcrypto` | 1.7.2 | MIT |
| `@rolldown/binding-darwin-arm64` | 1.2.16 | MIT |
| `@rolldown/pluginutils` | 1.0.1 | MIT |
| `@sindresorhus/is` | 4.6.0 | MIT |
| `@szmarczak/http-timer` | 4.0.6 | MIT |
| `@tailwindcss/node` | 4.3.4 | MIT |
| `@tailwindcss/oxide` | 4.3.4 | MIT |
| `@tailwindcss/oxide-darwin-arm64` | 4.3.4 | MIT |
| `@tailwindcss/oxide-wasm32-wasi` | 4.3.4 | MIT |
| `@tailwindcss/vite` | 4.3.4 | MIT |
| `@tmcw/togeojson` | 7.1.3 | BSD-2-Clause |
| `@tybys/wasm-util` | 0.10.3 | MIT |
| `@types/better-sqlite3` | 9.6.0 | MIT |
| `@types/cacheable-request` | 6.0.3 | MIT |
| `@types/chai` | 5.2.3 | MIT |
| `@types/debug` | 4.1.13 | MIT |
| `@types/deep-eql` | 4.0.2 | MIT |
| `@types/estree` | 1.0.10 | MIT |
| `@types/fs-extra` | 9.0.13 | MIT |
| `@types/geojson` | 7946.0.16 | MIT |
| `@types/http-cache-semantics` | 4.2.0 | MIT |
| `@types/keyv` | 3.1.4 | MIT |
| `@types/leaflet` | 1.9.22 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/node` | 24.19.2 | MIT |
| `@types/responselike` | 1.0.3 | MIT |
| `@typescript/typescript-darwin-arm64` | 7.0.2 | Apache-2.0 |
| `@vitejs/plugin-react` | 6.2.1 | MIT |
| `@vitest/coverage-v8` | 5.1.0 | MIT |
| `@vitest/istanbul-lib-coverage` | 2.1.0 | MIT |
| `@vitest/istanbul-lib-report` | 2.1.0 | MIT |
| `@vitest/mocker` | 5.1.0 | MIT |
| `@vitest/spy` | 5.1.0 | MIT |
| `@xmldom/xmldom` | 0.8.15 | MIT |
| `abbrev` | 4.0.0 | ISC |
| `agent-base` | 7.1.4 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ansi-regex` | 5.0.1 | MIT |
| `ansi-styles` | 4.3.0 | MIT |
| `anynum` | 1.0.1 | MIT |
| `app-builder-lib` | 26.18.0 | MIT |
| `argparse` | 2.0.1 | Python-2.0 |
| `asn1js` | 3.1.0 | BSD-3-Clause |
| `assertion-error` | 2.0.1 | MIT |
| `ast-v8-to-istanbul` | 1.0.7 | MIT |
| `async` | 3.2.6 | MIT |
| `async-exit-hook` | 2.0.1 | MIT |
| `asynckit` | 0.4.0 | MIT |
| `at-least-node` | 1.0.0 | ISC |
| `aws4` | 1.13.2 | MIT |
| `balanced-match` | 1.0.2 | MIT |
| `base64-js` | 1.5.1 | MIT |
| `baseline-browser-mapping` | 2.11.35 | Apache-2.0 |
| `better-sqlite3` | 13.0.3 | MIT |
| `bluebird` | 3.7.2 | MIT |
| `boolean` | 3.2.0 | MIT |
| `brace-expansion` | 1.1.21 | MIT |
| `browserslist` | 4.29.5 | MIT |
| `buffer` | 6.0.3 | MIT |
| `buffer-from` | 1.1.2 | MIT |
| `builder-util` | 26.16.0 | MIT |
| `builder-util-runtime` | 9.7.0 | MIT |
| `bytestreamjs` | 2.0.1 | BSD-3-Clause |
| `cac` | 7.1.0 | MIT |
| `cacheable-lookup` | 5.0.4 | MIT |
| `cacheable-request` | 7.0.4 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `caniuse-lite` | 1.0.30001822 | CC-BY-4.0 |
| `chai` | 6.3.0 | MIT |
| `chalk` | 4.1.2 | MIT |
| `chownr` | 3.0.0 | BlueOak-1.0.0 |
| `chromium-pickle-js` | 0.2.0 | MIT |
| `ci-info` | 4.4.0 | MIT |
| `cliui` | 8.0.1 | ISC |
| `clone-response` | 1.0.3 | MIT |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `combined-stream` | 1.0.8 | MIT |
| `commander` | 9.5.0 | MIT |
| `compare-version` | 0.1.2 | MIT |
| `concat-map` | 0.0.1 | MIT |
| `convert-source-map` | 2.0.0 | MIT |
| `core-util-is` | 1.0.3 | MIT |
| `cross-dirname` | 0.1.0 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `decompress-response` | 6.0.0 | MIT |
| `defer-to-connect` | 2.0.1 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `delayed-stream` | 1.0.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `dir-compare` | 4.2.0 | MIT |
| `dmg-builder` | 26.18.0 | MIT |
| `dotenv` | 16.6.1 | BSD-2-Clause |
| `dotenv-expand` | 11.0.7 | BSD-2-Clause |
| `drizzle-kit` | 0.31.11 | MIT |
| `drizzle-orm` | 0.45.4 | Apache-2.0 |
| `dunder-proto` | 1.0.1 | MIT |
| `duplexer2` | 0.1.4 | BSD-3-Clause |
| `ejs` | 3.1.10 | Apache-2.0 |
| `electron` | 45.2.3 | MIT |
| `electron-builder` | 26.18.0 | MIT |
| `electron-builder-squirrel-windows` | 26.18.0 | MIT |
| `electron-publish` | 26.18.0 | MIT |
| `electron-to-chromium` | 1.5.477 | ISC |
| `electron-vite` | 6.0.0 | MIT |
| `electron-winstaller` | 5.4.0 | MIT |
| `emoji-regex` | 8.0.0 | MIT |
| `end-of-stream` | 1.4.5 | MIT |
| `enhanced-resolve` | 5.26.1 | MIT |
| `env-paths` | 2.2.1 | MIT |
| `err-code` | 2.0.3 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-module-lexer` | 2.3.2 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `es-set-tostringtag` | 2.1.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `escalade` | 3.2.0 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `estree-walker` | 3.0.3 | MIT |
| `expect-type` | 1.4.0 | Apache-2.0 |
| `exponential-backoff` | 3.1.3 | Apache-2.0 |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-uri` | 3.1.9 | BSD-3-Clause |
| `fast-xml-builder` | 1.3.1 | MIT |
| `fast-xml-parser` | 5.12.0 | MIT |
| `fdir` | 6.5.0 | MIT |
| `filelist` | 1.0.6 | Apache-2.0 |
| `fit-file-parser` | 6.2.7 | MIT |
| `form-data` | 4.0.6 | MIT |
| `fs-extra` | 11.3.1 | MIT |
| `fs.realpath` | 1.0.0 | ISC |
| `fsevents` | 2.3.3 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `gensync` | 1.0.0-beta.2 | MIT |
| `get-caller-file` | 2.0.5 | ISC |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `get-stream` | 5.2.0 | MIT |
| `get-tsconfig` | 4.14.3 | MIT |
| `glob` | 7.2.3 | ISC |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `gopd` | 1.2.0 | MIT |
| `got` | 11.8.6 | MIT |
| `graceful-fs` | 4.2.11 | ISC |
| `has-flag` | 4.0.0 | MIT |
| `has-property-descriptors` | 1.0.2 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `has-tostringtag` | 1.0.2 | MIT |
| `hasown` | 2.0.4 | MIT |
| `hosted-git-info` | 4.1.0 | ISC |
| `http-cache-semantics` | 4.3.0 | BSD-2-Clause |
| `http-proxy-agent` | 7.0.2 | MIT |
| `http2-wrapper` | 1.0.3 | MIT |
| `https-proxy-agent` | 7.0.6 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `immediate` | 3.0.6 | MIT |
| `inflight` | 1.0.6 | ISC |
| `inherits` | 2.0.4 | ISC |
| `is-fullwidth-code-point` | 3.0.0 | MIT |
| `is-unsafe` | 2.0.3 | MIT |
| `isarray` | 1.0.0 | MIT |
| `isbinaryfile` | 5.0.7 | MIT |
| `isexe` | 4.0.0 | BlueOak-1.0.0 |
| `jake` | 10.9.4 | Apache-2.0 |
| `jiti` | 2.7.0 | MIT |
| `js-tokens` | 10.0.0 | MIT |
| `js-yaml` | 4.3.2 | MIT |
| `jsesc` | 3.1.0 | MIT |
| `json-buffer` | 3.0.1 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-stringify-safe` | 5.0.1 | ISC |
| `json5` | 2.2.3 | MIT |
| `jsonfile` | 6.2.1 | MIT |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| `keyv` | 4.5.4 | MIT |
| `lazy-val` | 1.0.5 | MIT |
| `leaflet` | 1.9.4 | BSD-2-Clause |
| `lie` | 3.3.0 | MIT |
| `lightningcss` | 1.33.0 | MPL-2.0 |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 |
| `lodash` | 4.18.1 | MIT |
| `lowercase-keys` | 2.0.0 | MIT |
| `lru-cache` | 5.1.1 | ISC |
| `magic-string` | 1.4.5 | MIT |
| `magicast` | 0.5.5 | MIT |
| `matcher` | 3.0.0 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `mime` | 2.6.0 | MIT |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `mimic-response` | 1.0.1 | MIT |
| `minimatch` | 10.2.6 | BlueOak-1.0.0 |
| `minimist` | 1.2.8 | MIT |
| `minipass` | 7.1.3 | BlueOak-1.0.0 |
| `minizlib` | 3.1.0 | MIT |
| `mkdirp` | 0.5.6 | MIT |
| `ms` | 2.1.3 | MIT |
| `nanoid` | 3.3.20 | MIT |
| `node-abi` | 4.40.0 | MIT |
| `node-addon-api` | 8.9.2 | MIT |
| `node-api-version` | 0.2.1 | MIT |
| `node-gyp` | 12.4.0 | MIT |
| `node-int64` | 0.4.0 | MIT |
| `node-releases` | 2.0.63 | MIT |
| `nopt` | 9.0.0 | ISC |
| `normalize-url` | 6.1.0 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `obug` | 3.0.0 | MIT |
| `once` | 1.4.0 | ISC |
| `oxlint` | 1.91.0 | MIT |
| `p-cancelable` | 2.1.1 | MIT |
| `p-limit` | 3.1.0 | MIT |
| `pako` | 1.0.11 | (MIT AND Zlib) |
| `path-expression-matcher` | 1.6.2 | MIT |
| `path-is-absolute` | 1.0.1 | MIT |
| `path-key` | 3.1.1 | MIT |
| `pe-library` | 0.4.1 | MIT |
| `picocolors` | 1.1.1 | ISC |
| `picomatch` | 4.0.7 | MIT |
| `pkijs` | 3.4.3 | BSD-3-Clause |
| `playwright` | 1.65.0 | Apache-2.0 |
| `playwright-core` | 1.65.0 | Apache-2.0 |
| `plist` | 3.1.0 | MIT |
| `postcss` | 8.5.32 | MIT |
| `postject` | 1.0.0-alpha.6 | MIT |
| `proc-log` | 6.1.0 | ISC |
| `process-nextick-args` | 2.0.1 | MIT |
| `progress` | 2.0.3 | MIT |
| `promise-retry` | 2.0.1 | MIT |
| `proper-lockfile` | 4.1.2 | MIT |
| `pump` | 3.0.4 | MIT |
| `pvtsutils` | 1.3.6 | MIT |
| `pvutils` | 1.2.0 | MIT |
| `quick-lru` | 5.1.1 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `read-binary-file-arch` | 1.0.6 | MIT |
| `readable-stream` | 2.3.8 | MIT |
| `require-directory` | 2.1.1 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `resedit` | 1.7.2 | MIT |
| `resolve-alpn` | 1.2.1 | MIT |
| `resolve-pkg-maps` | 1.0.0 | MIT |
| `responselike` | 2.0.1 | MIT |
| `retry` | 0.12.0 | MIT |
| `rimraf` | 2.6.3 | ISC |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `rolldown` | 1.2.16 | MIT |
| `safe-buffer` | 5.1.2 | MIT |
| `sanitize-filename` | 1.6.4 | WTFPL OR ISC |
| `sax` | 1.6.1 | BlueOak-1.0.0 |
| `scheduler` | 0.28.0 | MIT |
| `semver` | 5.7.3 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `setimmediate` | 1.0.5 | MIT |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `signal-exit` | 3.0.7 | ISC |
| `simple-update-notifier` | 2.0.0 | MIT |
| `source-map` | 0.6.1 | BSD-3-Clause |
| `source-map-js` | 1.2.2 | BSD-3-Clause |
| `source-map-support` | 0.5.21 | MIT |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `stat-mode` | 1.0.0 | MIT |
| `std-env` | 4.3.0 | MIT |
| `string-width` | 4.2.3 | MIT |
| `string_decoder` | 1.1.1 | MIT |
| `strip-ansi` | 6.0.1 | MIT |
| `strnum` | 2.5.1 | MIT |
| `sumchecker` | 3.0.1 | Apache-2.0 |
| `supports-color` | 7.2.0 | MIT |
| `tailwindcss` | 4.3.4 | MIT |
| `tapable` | 2.3.3 | MIT |
| `tar` | 7.5.22 | BlueOak-1.0.0 |
| `temp` | 0.9.4 | MIT |
| `temp-file` | 3.4.0 | MIT |
| `tiny-async-pool` | 1.3.0 | MIT |
| `tinybench` | 6.2.3 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `tinyglobby` | 0.2.17 | MIT |
| `tinyrainbow` | 3.2.0 | MIT |
| `tmp` | 0.2.7 | MIT |
| `tmp-promise` | 3.0.3 | MIT |
| `truncate-utf8-bytes` | 1.0.2 | WTFPL |
| `tslib` | 2.9.1 | 0BSD |
| `tsx` | 4.23.15 | MIT |
| `type-fest` | 0.13.1 | (MIT OR CC0-1.0) |
| `typescript` | 7.0.2 | Apache-2.0 |
| `undici` | 7.30.2 | MIT |
| `undici-types` | 8.9.0 | MIT |
| `universalify` | 2.0.1 | MIT |
| `unzipper` | 0.12.5 | MIT |
| `update-browserslist-db` | 1.3.4 | MIT |
| `utf8-byte-length` | 1.0.5 | (WTFPL OR MIT) |
| `util-deprecate` | 1.0.2 | MIT |
| `vite` | 8.3.6 | MIT |
| `vitest` | 5.1.0 | MIT |
| `webcrypto-core` | 1.9.2 | MIT |
| `which` | 2.0.2 | ISC |
| `why-is-node-running` | 3.2.1 | MIT |
| `wrap-ansi` | 7.0.0 | MIT |
| `wrappy` | 1.0.2 | ISC |
| `xml-naming` | 0.3.0 | MIT |
| `xmlbuilder` | 15.1.1 | MIT |
| `y18n` | 5.0.8 | ISC |
| `yallist` | 3.1.1 | ISC |
| `yargs` | 17.7.3 | MIT |
| `yargs-parser` | 21.1.1 | ISC |
| `yocto-queue` | 0.1.0 | MIT |
| `zod` | 4.6.7 | MIT |
| `zustand` | 5.0.16 | MIT |

</details>
