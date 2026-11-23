# Security

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability**
on this repository. Do not open a public issue. You should hear back within a week.

## Deployment model

Family Hub is built for a home LAN:

- The Planner is behind a PIN with lockout. Do not expose port 3000 to the internet directly;
  use something like Cloudflare Tunnel + Access in front of `/planner` and `/board` only
  ([docs/remote-access.md](docs/remote-access.md)).
- `/api/render` and the button webhooks are for Tesserae on the LAN and use per-device tokens,
  stored hashed. Keep them off any public hostname.
- Database backups contain the Tesserae MCP token and device credentials; treat them as secrets.
