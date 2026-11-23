# Selective VPN routing ("Use VPN for Agent Requests")

Settings → Agents → **شبکه** → *استفاده از VPN برای درخواست‌های Agent*. Off by default; saved in `.data/network.json`.

| Setting | Agent requests (API + CLI agents) | Confluence requests |
|---|---|---|
| Off | OS default route (unchanged behavior) | OS default route (unchanged behavior) |
| On | Pinned to the VPN interface; **fail** if no VPN is connected | Pinned to the normal (non-VPN) interface |

The app never connects, disconnects or configures the VPN, and changes no system routing, DNS or firewall settings.
Loopback / private-network destinations (local Ollama, LM Studio, LAN vLLM) always use the OS route.

## How it works

```
AgentHttpClient ─┐                         ┌─ pinned to VPN interface ──► AI APIs
                 ├─ NetworkRouter ─ relay ─┤
ConfluenceHttpClient ┘   (per request)     └─ pinned to Wi-Fi/Ethernet ─► Confluence
```

- `server/network/types.ts` – platform-independent `NetworkRoutingProvider` interface.
- `server/network/{linux,windows,macos}.ts` – detect interfaces, the VPN interface and the direct interface
  (classified by kernel link type / driver type, never by a hardcoded name or address). `index.ts` selects one per OS.
- `server/network/router.ts` – the setting, per-request path decision, VPN drop / reconnect detection, clear errors.
- `server/network/httpClient.ts` – `agentHttp()` and `confluenceHttp()`. With routing off they are plain `fetch`.
  With routing on they use an undici `ProxyAgent` scoped to that one request (nothing process-wide).
- `server/network/relay.py` – unprivileged helper on `127.0.0.1` (random port, random token). For each HTTP CONNECT
  tunnel it opens the outbound socket pinned to the requested interface and copies bytes. **TLS is end to end inside
  the app**: the helper never sees headers, tokens or bodies, and certificate verification is unchanged.
- CLI agents (Claude Code, Codex, Cursor, Gemini CLI) get `HTTPS_PROXY` etc. in **their own process environment only**.

Why a helper: Node cannot pin a socket to an interface, and binding only a source IP does **not** bypass a full-tunnel
VPN on Linux (verified: traffic still left via the VPN).

## Platform compatibility

| Platform | Mechanism | Status |
|---|---|---|
| Linux (kernel ≥ 5.7) | `SO_BINDTODEVICE` (unprivileged on an unbound socket) | **Verified** on Ubuntu, kernel 7.0, Happ/xray TUN full tunnel |
| Linux (kernel < 5.7) | – | Unsupported (toggle disabled) |
| Windows 10 / 11 | `IP_UNICAST_IF`; detection via `Get-NetAdapter` / `Get-NetRoute` | Implemented, unit-tested with recorded output, **needs manual validation** |
| macOS | `IP_BOUND_IF`; detection via `netstat` / `networksetup` | Implemented, unit-tested with recorded output, **needs manual validation** |
| Other | – | Unsupported (toggle disabled, behavior unchanged) |

## Requirements and permissions

- Python 3.8+ (`python3`; on Windows `py -3` or `python`). Standard library only. Missing → status "unavailable".
- No root / administrator rights. Everything runs as the current user.
- The helper only listens on loopback and requires the per-run token. It exits when the app stops.

## Verification (this machine, 2026-11-10, Happ/xray full tunnel `happ-xray` over Wi-Fi `wlo1`)

| Request | Setting off | Setting on |
|---|---|---|
| Agent egress IP | VPN IP | VPN IP (pinned to `happ-xray`) |
| Confluence egress IP | VPN IP → `/status` **403** | ISP IP (pinned to `wlo1`) → `/status` **200** |
| TLS with an expired certificate | – | rejected (`CERT_HAS_EXPIRED`) |
| Claude Code / Gemini CLI | – | connect through the relay (seen in relay debug log) |
| Cursor CLI | – | not verified (not logged in here); Codex not installed |

Re-check any time with **بررسی مسیرها** in the settings, or `POST /api/network/verify`. For manual checks, run the
helper with `SEED_RELAY_DEBUG=1` to log `host:port via interface` (never headers or tokens).

Tests: `server/network/router.test.ts` and `clients.test.ts` (unit), `platforms.test.ts` (unit, recorded OS output),
`relay.integration.test.ts` (real helper + sockets on Linux, pinned to `lo`), `src/components/NetworkSettings.test.tsx`.

## Rollback

Turn the setting off (or delete `.data/network.json`). The helper stops, and every request uses the OS route as before.
No system state is ever changed, so there is nothing else to undo. To remove the feature completely, revert the commit.

## Known limitations

- DNS for pinned requests is resolved by the OS resolver (which may itself go through the VPN). Pinning applies to the
  TCP connection. Split DNS (internal names only resolvable off-VPN) is not handled.
- IPv4 default routes only (Linux reads `/proc/net/route`). IPv6-only networks are not detected as direct.
- Split-tunnel VPNs: the agent host must be reachable via the VPN interface, otherwise the request fails with a clear error.
- VPN clients with a kill switch (Windows WFP, macOS `includeAllNetworks`) can block the direct path, so Confluence fails
  with "pin-failed" instead of silently using the VPN.
- CLI agents must honour `HTTPS_PROXY`. Verified for Claude Code and Gemini CLI. Unverified for Cursor and Codex.
- When several VPN interfaces are up, the one with the best default route (else the first) is used.
