# Remote access: hub.example.com

Decision: ADR-17 (`docs/architecture.md`). Cloudflare Tunnel + Cloudflare Access (email one-time
PIN) in front of the Planner only. No ports are opened: `cloudflared` dials out to Cloudflare.
The app trusts Cloudflare's signed login instead of the PIN there (ADR-18).

| | |
|---|---|
| Address | `https://hub.example.com` |
| Allowed emails | `you@example.com` (add more in the Access policy) |
| Login | Cloudflare Access email code only (ADR-18). The LAN address still asks for the Planner PIN |
| Public paths | `/`, `/planner/*`, `/board/*`, `/_app/*`, `/api/events`, `/manifest.webmanifest`, `/service-worker.js`, `/icons/*` |
| LAN only | `/api/tap`, `/api/button`, `/api/render` (Tesserae → Family Hub), `/sim`, `/healthz`; Tesserae itself (:8765) |

Run `cloudflared` on the same host and Compose project as Family Hub: on Unraid, uncomment it in
`deploy/unraid/docker-compose.yml` (`docs/unraid.md`). On the Mac (for a trial) it is the `tunnel`
profile. It reaches the app at `http://family-hub:3000` on the Compose network.

## Steps (owner, in the Cloudflare dashboard)

Set up Access **first**, so the hostname is never reachable without a login.

### 1. Access application
Zero Trust → Access → Applications → **Add an application** → **Self-hosted**.
- Name: `Family Hub`. Session duration: **1 month** (phones then rarely ask again).
- Public hostname: subdomain `hub`, domain `example.com`, no path (protects the whole host).
- Policy: name `Family`, action **Allow**, Include → **Emails** → `you@example.com`.
- Login methods: **One-time PIN** only. If it is not listed, add it under Zero Trust →
  Settings → Authentication → Login methods. The health dashboard's team domain is reused.
- Leave the rest at the defaults and save.

### 2. Tunnel
Zero Trust → Networks → Tunnels → **Create a tunnel** → **Cloudflared**, name `family-hub`.
- On the "install connector" screen, copy the **token** (the long string after `--token`).
  Do not run the install command shown; Compose runs the connector.
- In `.env` on the host that runs Family Hub (never committed):
  `CLOUDFLARE_TUNNEL_TOKEN=<token>`
- Start it: on Unraid uncomment `cloudflared` and Compose Up (Mac: `docker compose --profile tunnel up -d`). The tunnel shows **Healthy** in the
  dashboard within a few seconds. `docker compose logs cloudflared` shows "Registered tunnel
  connection" ×4.

### 3. Public hostname (route)
In the tunnel → **Public Hostname** → **Add a public hostname**:
- Subdomain `hub`, domain `example.com`.
- Path (a regex; only these reach the app, everything else gets the tunnel's 404):
  ```
  ^/($|planner(/.*)?$|board(/.*)?$|_app/|api/events$|manifest\.webmanifest$|service-worker\.js$|icons/)
  ```
- Service: type **HTTP**, URL `family-hub:3000`.
- Save. Cloudflare creates the DNS record. (`board` was added 2026-11-05 with ADR-30: a tablet
  away from the LAN can be a Board once an adult has logged in through Access on it to pair.)

### 4. Skip the PIN behind Access (ADR-18)
In the Access app → Overview, copy the **Application Audience (AUD) Tag**. Add to `.env` on
Unraid, then Compose Up:
```
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=<AUD tag>
```
Without these the app still works, it just asks for the PIN after the email code.

## Check it (anyone, from outside the LAN, e.g. phone on mobile data)

1. `https://hub.example.com` → Cloudflare login → enter `you@example.com` → code
   from email → Today (no PIN once step 4 is done).
2. From a laptop: `curl -sI https://hub.example.com/planner` → `302` to
   `*.cloudflareaccess.com` (Access is in front).
3. Logged in, open `https://hub.example.com/api/render/x/home.json` → **404** (tunnel path
   rule; it is LAN only). Same for `/sim`.
4. Lists → tick an item on the phone; it ticks on a LAN browser too (live refresh over SSE).

## Install on phones

- **iPhone (Safari):** open `https://hub.example.com`, log in, then Share → **Add to Home
  Screen**. The installed app keeps its own cookies, so log in once more inside it (email code).
  After that it opens straight in.
- **Android (Chrome):** open the address, log in, then menu → **Install app**. Long-press the icon
  for Lists / Today shortcuts.
- Offline, pages already opened still show (read only), with a banner.

## Add someone

Zero Trust → Access → Applications → Family Hub → Policies → Family → add their email under
Include → Emails. On the home Wi-Fi address they also need the Planner PIN.

## Turn it off

`docker compose --profile tunnel stop cloudflared` (instant), or delete the public hostname in
the tunnel. The LAN keeps working either way.

## Notes

- Login cookie: adapter-node reports `https` for every request, so the app marks the session
  cookie `Secure` only when `X-Forwarded-Proto: https` (set by Cloudflare). Plain-HTTP LAN gets
  a non-Secure cookie that phones keep.
- `<link rel="manifest" crossorigin="use-credentials">`: without it, browsers fetch the manifest
  without the Access cookie and Access redirects it, which breaks install.
- The live feed (`/api/events`) sends a keep-alive every 15 s, under Cloudflare's 100 s idle limit.
