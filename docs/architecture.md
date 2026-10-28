# Architecture

Quiet runs an Edge process on a separate Win32 desktop in the current Windows session. The user stays on the normal input desktop and watches a local preview. No VM is involved.

![Session and control flow](assets/session-flow.svg)

## Processes

| Component | Responsibility |
| --- | --- |
| Edge extension | Reviews cookie-domain metadata and transfers selected cookies after authorization. |
| Bridge · `127.0.0.1:9467` | Checks the local pairing token and extension origin, imports sessions, and handles browser commands. |
| Native desktop host | Creates the desktop and launches the agent browser in a Windows job object. |
| Agent Edge | Keeps its own persistent profile in `%LOCALAPPDATA%\Quiet\agent-profile` (or `.runtime/agent-profile` in development). |
| Preview service · `127.0.0.1:9468` | Authenticates viewers, captures the agent desktop, and handles pointer commands. |
| Workspace host | Starts the agent's Explorer shell and hides its icon view and taskbar. |
| Mini control | Opens the viewer and pauses/resumes the agent from a nonactivating native window. |
| MCP server | Exposes browser operations to an existing agent client over stdio. |

The main desktop job owns the agent browser. The workspace job owns only the extra Explorer shell. Restarting the preview does not intentionally shut down the browser job. Closing the main bridge closes its owned browser processes.

## Session transfer

The extension reads domain names and cookie counts for review. Cookie values leave the extension only after **Share sessions**, and travel to the paired loopback service. The bridge imports approved cookies through the agent browser's local DevTools connection.

The source cookies are not modified. There is no cookie-export command or continuous session synchronization. Partitioned cookies are excluded. Setup generates a per-installation extension identity and local pairing configuration.

The extension requests broad HTTP/HTTPS host permissions because it offers session transfer for user-selected sites. Authorization is explicit; selecting or searching domains alone does not transfer cookie values.

## Browser input

DOM operations use element references from the latest read. Visual operations use CSS coordinates in an owned page's viewport. The visible cursor is an input-transparent page overlay; mouse events are sent through the browser's input API. It does not move the Windows cursor. Curved movement paths use `ghost-cursor`.

Pause blocks mutations and is checked between pointer movement steps. A click response reports dispatch, not completion. The caller must read, wait or inspect the page to verify the outcome.

## Preview transport

Native capture uses reusable GDI DIB surfaces and `PrintWindow`. Application windows are captured each frame; static Explorer wallpaper is refreshed once per second. JPEG frames travel over binary local IPC and an authenticated WebSocket. The viewer presents the newest decoded bitmap and drops superseded frames.

Edge's transparent popup margins are flattened to black by `PrintWindow`. The compositor clips interactive Chromium popups to their `WM_NCHITTEST` outline, cached until the window changes size. This preserves black content inside the popup without sending mouse input. If the outline cannot be determined within a bounded time, capture falls back to the full window.

The desktop is captured at up to 1920 pixels wide. The viewer handles scaling. The 30/60 fps settings are targets; the displayed counter measures presented frames. Capture stops when no visible viewer requests a stream.

## Boundaries

A separate Win32 desktop separates windows. It does **not** isolate files, processes, network access or the Windows user's permissions. Only one agent desktop is supported. Pointer input is limited to browser pages; other applications, browser chrome and native dialogs are outside the current scope.

The session bridge and preview run locally. An MCP client can forward page text and screenshots to its chosen model provider. Its data handling is separate from Quiet's local transport.

`.runtime/`, generated extension pairing files, browser profiles and test output are excluded from Git. The installer is built from an explicit file list and initializes pairing on the destination machine. Installed user data stays outside the program directory.

## Stable updates

Installed builds query GitHub's latest-release endpoint. The updater requires a published non-prerelease tag with a numeric version, an installer asset under the official repository and a SHA-256 digest. It does not fetch Git branches. Active services defer installation.

The download is verified before the native update helper receives it. The helper waits for the launcher to exit, verifies the file again, runs the per-user installer and reopens Quiet. The installer preserves the separate data directory. Source checkouts do not run this update path.
