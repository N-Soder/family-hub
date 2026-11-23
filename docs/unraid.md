# Running on Unraid

Production home for Family Hub + Tesserae (always on; the wall and the phone app depend on it).
Server: `192.168.1.50`. Stack: Compose Manager, file `deploy/unraid/docker-compose.yml`.

**Live since 2026-10-31 14:57.** The wall (`reterminal_e1003_19065c`) polls
`http://192.168.1.50:8765`; Planner at `http://192.168.1.50:3000/planner`. The Mac stack is
stopped (kept for rollback: point the wall back at the Mac and `docker compose start`).

## Share
- Folder `family-hub` in the `projects` share, which holds every Compose stack (pick-adventure,
  openchaos, ...). Mounted on the Mac at `/Volumes/projects`. **Primary storage: cache pool,
  secondary: none** (keeps SQLite off the array and away from the mover).
- The share is for files only. Containers use it as local disk on Unraid; never open the
  database over SMB while the stack runs.
- Until 2026-11-21 the stack had its own share, `family-hub` (see "Move to the projects share").
  That share is the rollback copy until 2026-11-28, then delete it. Nothing reads it now.

Layout (see the header of the compose file):
```
/mnt/user/projects/family-hub/
  docker-compose.yml     deploy/unraid/docker-compose.yml
  .env                   from the Mac's .env, HOST_LAN_IP=192.168.1.50
  app/                   git archive of this repo (built on Unraid, amd64)
  data/family-hub/       family-hub.db
  data/tesserae/         Tesserae data, including the wall's pairing
  backups/               manual pre-migration copies from 2026-11-01/02 (before ADR-31); keep
```

## Move to the projects share (2026-11-21)
**Done 2026-11-21 ~18:05.** Compose Up from the new folder, `/healthz` ok. The `-wal` held the
day's writes (4 MB, db file a day older) and was copied with the database. Live commit unchanged
(`app/DEPLOYED` = `087032f`); only the compose file's comments differ from `main`.

One-off, run in the Unraid web terminal as root. Copying on the server keeps Tesserae's
root-owned files and avoids SMB's `._` name veto. About five minutes down; the wall keeps its
pairing because the IP and ports do not change.
1. Compose Manager → `family-hub` → **Compose Down**.
2. `docker ps` lists no `family-hub` or `tesserae` container. `family-hub.db-wal` and `-shm` may
   still sit next to the database: copy them with it and never delete them here (the WAL can hold
   committed writes; SQLite replays it on the next open). Deleting them applies only when
   *replacing* the database with a backup.
3. `rsync -a /mnt/user/family-hub/ /mnt/user/projects/family-hub/`, then
   `diff -rq /mnt/user/family-hub /mnt/user/projects/family-hub` prints nothing.
4. Point the stack at the new folder: `cat /boot/config/plugins/compose.manager/projects/family-hub/indirect`
   shows `/mnt/user/family-hub`; write `/mnt/user/projects/family-hub` into it. (Or delete the stack
   in Compose Manager and add `family-hub` again with Indirect Path `/mnt/user/projects/family-hub`;
   keep the name so container names stay the same.)
5. **Compose Up**; check `/healthz`, the Planner, and a tap on the wall.
6. Keep the old `family-hub` share a week as the rollback (point the stack back, Compose Up), then
   delete it.

## Move from the Mac (one-off, 2026-10-31; used the old `family-hub` share)
1. Mount the share on the Mac (Finder → Go → Connect to Server → `smb://192.168.1.50/family-hub`,
   user `family-hub`).
2. Copy `app/`, `docker-compose.yml` and `.env` (no downtime yet).
3. Compose Manager → Add New Stack `family-hub` → stack directory `/mnt/user/family-hub`.
   Do not start it yet.
4. Cut over: back up the database on the Mac (`VACUUM INTO`), `docker compose stop` on the Mac,
   copy the backup to `data/family-hub/family-hub.db` and `data/tesserae/` to the share.
5. Compose Manager → Compose Up (first build takes a few minutes). Check
   `http://192.168.1.50:3000/healthz` → `{"ok":true}`, then log in to the Planner.
6. Point the wall at `http://192.168.1.50:8765` (setup portal; re-flash to reopen it).
   Tap a step and check it ticks.
7. Leave the Mac stack stopped (`docker compose down` once happy). Running both would have two
   apps answering for the same wall.

### What we hit (2026-10-31)
- Compose Manager: set **Indirect Path** `/mnt/user/family-hub` only (it refuses both path and
  file). It leaves our `docker-compose.yml` alone.
- Copying from a Mac: Unraid's SMB vetoes names starting `._`, and rsync's temp names can start
  that way (`_journal.json`), so use `rsync --inplace` with `COPYFILE_DISABLE=1`.
- Files Tesserae writes on Unraid are owned by root, so they cannot be overwritten or deleted
  over SMB. Only runtime state (status, stats, render cache) differed; the pairing did not.
- Before replacing the database, Compose Down and delete any leftover `family-hub.db-wal` and
  `-shm` next to it.
- The wall's server URL can only be changed in its setup portal. Re-flashing at
  tesserae.ink/flash opens the portal and keeps the device id; Tesserae kept its settings, so
  only the new server URL was needed.

## Update after a code change (the normal deploy)

The source is copied from the Mac to the share, and Unraid builds and runs it. Nothing is
pushed to a registry, and there is no CI. The repo has no git remote: commits live on the Mac only.

**Who does what.** Steps 1–3 run on the Mac, where the `projects` share is mounted and the stack folder is `/Volumes/projects/family-hub`.
Claude can do them. Step 4 is a button in Unraid's web UI, so the owner presses it (Claude's
shell cannot reach LAN hosts, only the mounted share). Step 5 is checked in a browser and on
the wall.

1. **Commit.** `git archive` ships the commit, not the working tree, so uncommitted changes
   are left out. Run `npm test` and `npm run check` first.
2. **Migrations back themselves up.** When the change adds a migration (`drizzle/`), the app
   copies the database to `data/family-hub/backups/family-hub-pre-NNNN-*.db` on start, before
   migrating (ADR-31). Rolling back past a migration needs that copy.
3. **Sync `app/` to the commit.** The commit is unpacked into a temporary folder and synced
   into `app/`; `app/` itself is never deleted (Claude Code refuses `rm -rf` on a folder at the
   top level of a mounted drive, and the old delete-and-recreate also hit undeletable files):
   ```sh
   cd ~/repositories/Personal/home-dashboard
   export COPYFILE_DISABLE=1                       # no macOS ._ files (Unraid's SMB rejects them)
   cat /Volumes/projects/family-hub/app/DEPLOYED            # what is live now: HEAD must contain it
   git merge-base --is-ancestor $(cut -d' ' -f1 /Volumes/projects/family-hub/app/DEPLOYED) HEAD && echo ok
   stage=$(mktemp -d)
   git archive HEAD | tar -x -C "$stage"
   git log -1 --format='%H %cs %s' > "$stage/DEPLOYED"   # what is live
   rsync -rlc --delete --inplace "$stage/" /Volumes/projects/family-hub/app/
   ```
   If the `is-ancestor` check prints nothing, stop: deploying would roll production back.
   *Once only, after the 2026-11-23 history reset for GitHub:* `main` restarted from a single
   commit and the old history is the local-only branch `private-history`. While `DEPLOYED`
   still names an old commit, check `git merge-base --is-ancestor <DEPLOYED> private-history`
   instead, and that `git diff private-history main` shows only the publishing changes (names,
   addresses, licence, CI) plus your new work. Every deploy after that uses the normal check.
   `-c` compares contents, so only changed files are written (git archive gives every file the
   commit's time, so comparing times would rewrite them all); `--delete` removes files the commit
   no longer has; `--inplace` avoids rsync's temporary names, which can start with `._`. macOS's
   built-in `/usr/bin/rsync` (openrsync) supports all three.
   Files Unraid owns as root (`app/docker-compose.yml`, `app/deploy/unraid/docker-compose.yml`)
   cannot be written over SMB. They are skipped while unchanged; if a deploy changes one, rsync
   reports it and the owner deletes it from Unraid, then the sync is run again.
   Only `app/` changes. `.env`, `data/` and the share's `docker-compose.yml` stay as they are.
   If `deploy/unraid/docker-compose.yml` changed, copy it to the share root as well.
4. **Compose Up.** Unraid → Docker → Compose Manager → `family-hub` → **Compose Up**.
   `pull_policy: build` rebuilds the image on every Compose Up. Cached layers make this quick
   unless `package-lock.json` changed (then a few minutes). Without that setting, Compose would
   keep the first image and the new code would never go live.
5. **Check:**
   - `http://192.168.1.50:3000/healthz` returns `{"ok":true}`.
   - The Planner (`http://192.168.1.50:3000/planner`) shows the change.
   - The wall: tap a step and check it ticks. When the wall's page changes (`tesserae/paint/`,
     `tesserae/pages/`), Family Hub re-imports it into Tesserae on start
     (`TESSERAE_AUTO_BOOTSTRAP`) and sends a full frame. Expect the wall to refresh about a
     minute after Compose Up.

**Rollback:** run step 3 with the previous commit (`git archive <sha>`), then Compose Up. If a
migration ran in between, Compose Down first and restore its `pre-NNNN` backup (see Backups). Delete any
`family-hub.db-wal` and `-shm` files next to the database before Compose Up.

**What is live:** `app/DEPLOYED` names the commit. Older deploys (before 2026-10-31 evening)
have no such file.

Never run the Mac's Compose stack while the wall points at Unraid. Two apps would answer for
one wall.

## Backups
The app backs up its own database (ADR-31), into `data/family-hub/backups/` on the share:

- `family-hub-YYYYMMDD-HHMM.db`: one per day (Perth time), taken at start and then checked
  hourly. The newest 14 are kept.
- `family-hub-pre-NNNN-YYYYMMDD-HHMM.db`: taken on start before migration `NNNN` runs. The
  newest 5 are kept.

Each copy is checked with `integrity_check` and `foreign_key_check`; the container log shows
`[backup] <file>`, or the problems found. The copies sit on the same disk as the database, so
include the share in Unraid's appdata backup too (not yet confirmed). Backups contain the
Tesserae MCP token and the simulator's device credentials: treat them as secrets.

**Restore** (tested in `tests/unit/backup.test.ts`, not yet drilled on Unraid):
1. Compose Manager → Compose Down.
2. Move `data/family-hub/family-hub.db` aside, and delete `family-hub.db-wal` and
   `family-hub.db-shm` next to it.
3. Copy the chosen backup to `data/family-hub/family-hub.db`.
4. Compose Up. Pending migrations run on the copy (after taking their own pre-migration
   backup). Check `/healthz` and the Planner.

## Remote access
Uncomment `cloudflared` in the compose file once `CLOUDFLARE_TUNNEL_TOKEN` is in `.env`; see
`docs/remote-access.md`.
