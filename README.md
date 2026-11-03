# dsh-page-refresh-macos

Refresh button and a power menu (restart / quit) for the **DeepSeek Harness Web GUI**, built for **macOS**.

The original [`dsh-page-refresh`](https://github.com/day-day-dream/dsh-page-refresh) is Windows-only by construction — it drives `powershell.exe`, `taskkill.exe`, `wscript.exe` and a WMI launcher. On macOS those binaries do not exist, so the restart and quit actions fail with `spawn powershell.exe ENOENT`. This plugin re-implements the same two capabilities natively.

## Features

- **Refresh** — reloads the page in place, identical to <kbd>F5</kbd>; session data is preserved.
- **Restart** — stops the host and starts it again with the *exact* original executable, arguments and working directory.
- **Quit** — stops the host and leaves it stopped.
- Menu and controls follow the active light/dark theme through `--dsw-alias-*` design tokens.

## Install

```bash
# from this checkout
dsh plugin --profile <your-profile> add /absolute/path/to/dsh-page-refresh-macos
```

Then enable the bundle in the plugin list and reload the page. The two buttons appear in the conversation header, right-aligned.

The package is a Cordis bundle: `cordis.patch.yml` inserts one row, `index.js` is the Host half (HTTP routes), `client.js` is the browser half (UI).

## How restart works on macOS

There is no watchdog and no Electron shell on macOS: the harness runs as a plain `node` process (`node …/dsh/lib/bin.js web`). That simplifies things compared with the Windows build, which had to write a `quit-requested` record into an update journal so a keepalive task would not resurrect the app.

1. The Host records `process.execPath`, `process.argv.slice(1)` and `cwd` at load time.
2. On `POST /api/power-macos/restart` it spawns `relaunch.sh` detached, so the helper outlives the process it is about to kill.
3. The helper sends `SIGTERM`, waits for the port to close, relaunches with the recorded command, then **waits for the port to listen again** before reporting success.

Step 3 matters: "spawned a process" is not "restart succeeded". This helper verifies the listener actually comes back, and gives up after 60 seconds with a clear log line.

Quit takes the same path minus the relaunch.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/power-macos/status` | Read-only self-check: platform, pid, port, recorded argv, helper presence. No side effects. |
| `POST` | `/api/power-macos/restart` | Restart the harness. |
| `POST` | `/api/power-macos/close` | Quit the harness. |

All three are **loopback-only**: the request must arrive from `127.0.0.1`/`::1` *and* carry a `Host` header naming a local interface. A spoofed `Host` is rejected with `403`. These endpoints can stop the server, so they must never be reachable from another device.

## Logs

Every action is appended to `~/.dsh/logs/dsh-power-macos.log`, including the reason for each failure. When a restart does not come back, read that file first — the client shows its path in the failure message.

## Requirements

- macOS
- DSH `>= 0.2.0-rc.2`

The routes refuse to run on non-darwin platforms with an explicit error rather than silently failing.

## Layout

```
index.js            Host half: routes, argv capture, loopback fence
client.js           Browser half: refresh button + power menu
relaunch.sh         Detached helper: stop, relaunch, verify the port
cordis.patch.yml    Bundle patch (one row)
locale/{zh,en}.json Plugin metadata shown in the plugin list
icon.svg            Plugin icon
```

## License

MIT
