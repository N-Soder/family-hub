# Hardware setup — Seeed reTerminal E1003 with Tesserae

Written from the Tesserae docs (2026-10-24) before the device arrived. Verify each step on
first use and correct this file.

## Device
- 10.3" mono e-paper, 16-level grey, 1872×1404 native (landscape), capacitive touch,
  ESP32-S3, three front buttons (left, right, refresh), battery in the case, USB-C.
- We mount it **portrait (1404 wide × 1872 tall)** on **battery** (since 2026-11-10, ADR-34), waking once a day.

## 1. Flash Tesserae unified firmware
1. Use Chrome or Edge (Web Serial). Firefox/Safari will not work.
2. macOS: install the WCH CH34x driver first (https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html,
   then open the CH34xVCPDriver app → Install, and allow it under System Settings → Login Items &
   Extensions → Driver Extensions). The E1003's USB bridge is WCH `1a86:7522`, which macOS's
   built-in driver does not claim: without the WCH driver the device shows in System Information
   but no `cu.wchusbserial*` port appears and Chrome's port list only has Bluetooth entries.
3. Open https://tesserae.ink/flash, connect over USB-C, choose device kind
   **reTerminal E1003**. Picking the wrong kind can be corrected by re-flashing; Tesserae keeps
   the device ID.
4. Flash the latest firmware. Minimums we rely on: **≥ 1.44.0** (touch-wake modes),
   ≥ 1.21.0 (stale-frame signal). Flashed 2026-10-31: **1.62.2**; device id
   `reTerminal_E1003_19065c`. The serial log prints a JSON `hello` line with fw, kind and MAC.

## 2. Pair
1. After flashing the device opens a Wi-Fi AP **`Tesserae-Setup`**, password **`tesserae`**,
   portal at `http://192.168.4.1` (900 s idle timeout; power-cycle to reopen). Join it.
2. Pick a **2.4 GHz** network (ESP32-S3 has no 5 GHz). Enter home Wi-Fi credentials and the Tesserae server URL, e.g. `http://<unraid-ip>:8765`
   (on the Mac during development: the Mac's LAN IP; Colima publishes 8765 to the host).
3. In Tesserae: Settings → Devices → Discovered → **Register**. The access token is issued on
   the next poll; nothing to type.

## 3. Configure the device in Tesserae (Settings → Devices → this device)
| Setting | Value | Why |
|---|---|---|
| Transport | REST | No MQTT broker needed |
| Orientation | Portrait | Confirm touch hit-testing is upright (rotated-panel fix landed v0.436.1) |
| Touch input | **Off** (since 2026-11-03, ADR-28) | The kids tick on the iPad; the wall is display-only and the side buttons change the screen |
| Touch wake / linger | (moot with touch off) | Was: any tap, linger 30 s |
| Beep on interaction | On, tone **rising** (off in quiet hours) | Covers the gap before the patch lands; "rising" reads as "on its way" |
| Always on | **Off** (since 2026-11-10, ADR-34) | Was `always_on: true`, `awake_poll_s: 5` on USB. Always-on keeps Wi-Fi up and flattened the battery in about a day |
| Schedule → Synchronized wake | Mode **At set times only**, **Times** box `06:15` (not Anchor, which is for on-the-clock mode; an empty Times box falls back to the sleep interval) | One wake a day. Nothing pulls a set-times wake earlier. Keep the time outside quiet hours or it is skipped |
| Sleep interval | 86400 (1 day) | Fallback only, used if no set time is usable |
| Quiet hours | Server's 20:30–06:00, kept | A set wake time inside the window (06:00 included) is skipped every day; 06:15 is outside it |
| Button map | Paste from Planner → Settings → Devices → **Side buttons** | `left` / `right` / `refresh` → `webhook:` Family Hub's `/api/button/<device>/home/prev|next|home?k=<token>`. Copy it again after rotating the token or re-running "Set up on Tesserae". Since ADR-35 every button repaints Home (the wall has one screen) |

Applied 2026-10-31 to `reterminal_e1003_19065c`: portrait 1404×1872, always-on 10 s, touch on
(tap), linger 30 s, beep rising, quiet hours 20:30–06:00 daily with touch off. Quiet hours
save through their own form (`/settings/devices/<id>/quiet-hours`), not the main device form.
**Firmware 1.62.2 applies the beep tone only at boot:** the new pattern is in the `/status`
config straight away, but the panel keeps playing the old one until it restarts. Restart with
the power switch or reset button; unplugging USB does not, as the battery keeps it running.

Change these on Tesserae's device card by hand. Its save form sets every setting it is not
sent to off or default (verified in the 0.475.0 source, `values_from_form`), which is why
Family Hub never posts device settings itself.

`always_on`, `awake_poll_s`, `touch_enabled`, `touch_linger_s` and beep are per-device config
(Settings → Devices → device card, or `POST /settings/device-<id>`); the device receives them on
its next `/status`. Verified against the 0.475.0 source; confirm on the real card.

## 4. Assign the dashboard
- In the Planner: Devices → Add device, using the id Tesserae shows for the E1003 → **Set up
  on Tesserae**. Family Hub imports `tesserae/pages/wall.json` as "Family Hub · <id>" with a
  fresh device token, binds it to the device and pushes a full frame. Rotating the token
  re-imports the page. Do not edit that page in Tesserae's editor; changes are overwritten.
- Schedule: always-on off, synchronized wake "At set times" 06:15 (ADR-34).
- Confirm with Settings → Devices → Touch monitor that taps show outcome `fired`, and that
  `render_report.tap_invalid` is empty for the page.

## 5. Tesserae server settings worth pinning
Family Hub's bootstrap sets the admin password (`TESSERAE_ADMIN_PASSWORD`), timezone
(`TZ_HOUSEHOLD`), webhook token (`TESSERAE_PUSH_TOKEN`) and an MCP token on a fresh Tesserae.

- Image `ghcr.io/dmellok/tesserae:0.475.0`; `./data:/app/data`; `TESSERAE_SECRET_KEY` (64 hex)
  set before storing anything; `TESSERAE_HOST_IP` = host LAN IP under bridge networking.
- Settings → System → Authentication: password **on**. Do not widen trusted networks.
- MCP stays on for previews; it is loopback-trusted. Set `TESSERAE_MCP_TOKEN` on the tool side
  only if calling from another host.

## Troubleshooting (from the docs)
- Garbled/striped output: server older than v0.64.60. Upgrade.
- Panel stops painting at very low battery: charge over USB ~1 h. At one wake a day this should be rare; check the battery % on the device card.
- A tap does nothing: check Touch input is on, the page has hotspots, and the frame on glass is
  current (stale frames drop taps by design).
- E-ink full refresh takes seconds; a single-row patch should not. If every tap causes a full
  flash, the patch path is not working: check firmware version and the Touch monitor.
