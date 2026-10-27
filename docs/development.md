# Development

## Build

Use Windows with Microsoft Edge, Node.js 22+ and the .NET Framework C# compiler. Native hosts build from source; no .NET SDK is required.

```powershell
npm ci
npm run setup
npm run setup:workspace
npm run setup:preview
npm run setup:mini
```

Setup creates `.runtime/config.json`, `extension/manifest.json`, `extension/connection.local.js` and `mcp-config.local.json`. These files belong to the installation and are ignored by Git. The checked-in extension template and MCP example stay portable.

Run `npm run start:background` to start the bridge. `npm start` keeps diagnostics in the terminal. `npm run preview` opens the mini control; `npm run preview -- --viewer` opens the viewer directly.

## Tests

```powershell
npm test
npm run test:mini
npm run test:pointer
npx playwright install chromium
npm run test:integration
```

| Suite | What it checks |
| --- | --- |
| Unit | Session scope, cookie normalization, command validation, authentication and response redaction. |
| Mini | Authenticated native controls and opening without activation. |
| Pointer | Trusted hover/click events, coordinate bounds, owned targets, pause interruption, MCP tools and unchanged physical input. |
| Integration | Native desktop lifecycle, shell visibility, synthetic authenticated workflows, extension consent and viewer controls. |

Native suites require an interactive Windows session and use temporary browser profiles. They do not read the user's source browser profile or real site sessions. The Chrome for Testing harness has a test-only sandbox workaround for this host; production Edge keeps its normal sandbox.

GitHub Actions runs unit tests on Node.js 22 and 24 and compiles the Windows hosts. It does not claim coverage of interactive desktop behavior on hosted runners.

## Documentation captures

```powershell
npm run docs:capture
```

This launches a temporary Edge profile on a separate native desktop, operates a local demo page, then captures the actual viewer with headless Edge. The page is labeled as sample content. No personal account, session, wallpaper or desktop file is used in these captures.

The consent and native-control images come from the synthetic extension and mini-control test runs. Copy only the selected UI captures into `docs/assets`; keep generated configuration and private test metadata out of the repository.

## Source map

```text
extension/   Domain consent and local session transfer
monitor/     Live viewer and resizable panels
native/      Win32 desktop, capture and mini control
src/         Bridge, browser operations, MCP and preview services
scripts/     Setup, launchers and documentation captures
test/        Unit and Windows integration suites
```

## CLI

```powershell
node src/cli.mjs status
node src/cli.mjs open https://example.com
node src/cli.mjs read TAB_ID
node src/cli.mjs pause
node src/cli.mjs resume
node src/cli.mjs close TAB_ID
node src/cli.mjs stop
```

The JSON command mode accepts the validated protocol in `src/protocol.mjs`. It does not expose arbitrary JavaScript or OS input.

## Dependencies

Inter is distributed under the SIL Open Font License, Phosphor Icons under MIT, and ghost-cursor under ISC. Their licenses remain in the respective npm packages. See [Inter](https://github.com/rsms/inter), [Phosphor Icons](https://github.com/phosphor-icons/phosphor-core) and [ghost-cursor](https://github.com/Xetera/ghost-cursor).
