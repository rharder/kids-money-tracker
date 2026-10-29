# Development and computer transfer guide

This document is the handoff guide for continuing Family Money Tracker on another computer. The repository contains the complete application and Git history. Live family data and account credentials deliberately live outside Git.

## Moving development to another computer

Cloning from GitHub is preferred over manually copying the folder because it reliably brings over the complete commit history and remote configuration:

```bash
git clone https://github.com/rharder/kids-money-tracker.git
cd kids-money-tracker
```

If the folder is copied manually instead, include the hidden `.git` directory. Copying only the visible files produces the current source but loses the local Git history and remote configuration. The authoritative remote is:

```text
https://github.com/rharder/kids-money-tracker
```

Configure Git identity and GitHub authentication on the new computer. These are user-level credentials and are intentionally not stored in this repository:

```bash
git config --global user.name "Your Name"
git config --global user.email "your-github-email@example.com"
```

Use a new SSH key, GitHub CLI login, or another normal GitHub credential on the new computer. Never commit an SSH private key or access token.

## Private or external items

### Family data backup

The real ledger is stored in Cloud Firestore, not in Git. Before moving computers, use **Backup data** in the live app to download a JSON backup. Transfer that file privately—for example with encrypted cloud storage or an encrypted removable drive—and keep it outside the repository.

The standard `family-money-backup-YYYY-MM-DD.json` filename and the local `backups/` directory are ignored by Git to reduce the chance of committing family data.

The backup is a safety copy, not a required part of normal setup. After signing in on the new computer with an approved Google account, the app reads the current ledger from Firestore.

### Firebase access

The application uses Firebase project `kids-money-tracker-f24be` and Firestore document `families/main`. Access to the Firebase Console comes from the authorized Google account; there is no Firebase password or private application key to copy.

`firebase-config.js` is committed because Firebase web configuration is public project identification, not a secret. The browser app does not use a service-account key. Do not create or commit a Firebase Admin/service-account JSON key for routine development.

If Firebase CLI work is needed on the new computer, install the CLI and sign in there normally. Do not copy Firebase CLI login tokens between computers. This repository currently does not contain `firebase.json` or `.firebaserc`, so `firebase deploy` is not configured. Firestore rules can be edited from `firestore.rules` and published in the Firebase Console, or CLI configuration can be added deliberately later. `firebase.json` and `.firebaserc` contain project configuration rather than secrets and may be committed if CLI deployment is introduced.

Confirm these external Firebase settings if authentication or deployment stops working:

- Google Authentication is enabled.
- `rharder.github.io` is an authorized Authentication domain.
- Add `localhost` as an authorized domain if Google sign-in will be tested locally.
- Firestore is in the `nam5` U.S. multi-region.
- The rules published in Firebase match `firestore.rules`.

### Browser and installed-app data

Do not copy browser storage, Safari data, or the installed PWA between computers. The app rebuilds its device-local cache after an approved account signs in and completes one successful sync.

The local cache uses these browser-storage keys:

- `familyMoneyTracker.v3` — the latest ledger snapshot
- `familyMoneyTracker.access.v1` — the last approved account and access mode

Cached data appears immediately at startup and is read-only while offline. Firebase loads in the background and replaces the snapshot after fresh data arrives.

### Codex conversation history

Git does not contain Codex task messages or the full design conversation. Use the same Codex/OpenAI account if that history is available there. The durable technical decisions needed to continue the project are summarized in this document; future important decisions should be added here or to normal commit messages rather than existing only in chat.

## Project structure

The app is static HTML, CSS, and JavaScript with no package dependencies or build step.

- `index.html` — application shell and metadata
- `styles.css` — responsive desktop and mobile layout
- `app.js` — state, rendering, transactions, authentication, Firebase sync, demo mode, and cached-first startup
- `firebase-config.js` — public Firebase web configuration and Firestore document path
- `firestore.rules` — server-side owner and viewer authorization rules
- `sw.js` — service worker and offline application-shell cache
- `demo-data.js` — fictional screenshot/demo data
- `manifest.webmanifest` and icon files — installable PWA metadata and artwork
- `.github/workflows/pages.yml` — automatic GitHub Pages deployment

The ledger schema is version 3. It tracks **Short Term**, **Long Term**, and **Very Long Term**. Pocket money and Tithe are intentionally untracked. The Firestore document stores kids, transactions, the owner UID/email, and approved viewer emails.

## Running locally

Serve the repository over HTTP rather than opening `index.html` directly. From the repository directory, one simple option is:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173/
```

The fictional-data demo is available at:

```text
http://localhost:4173/?demo=1
```

Demo mode never reads or writes the live family ledger.

## Offline and cache behavior

The app renders the last locally saved ledger immediately. Firebase libraries and network data load afterward. While that refresh is happening, the dashboard remains visible and the status reads **Refreshing…**. Offline snapshots are read-only.

`sw.js` precaches the application shell. When changing a cached application file, increment the `CACHE` value near the top of `sw.js` so installed copies receive the new version. Test at least one online load followed by an offline reopen, especially on iPhone/Safari.

## Validation and deployment

Before committing JavaScript changes:

```bash
node --check app.js
node --check sw.js
git diff --check
```

Pushing `main` triggers `.github/workflows/pages.yml`, which publishes the repository to:

```text
https://rharder.github.io/kids-money-tracker/
```

After deployment, verify the normal app, the `?demo=1` view, Google sign-in, and the cached-first/offline behavior when the change touches those areas.

## What must never be committed

- Real family-data JSON backups
- Firebase Admin or service-account private keys
- GitHub tokens, SSH private keys, or other credentials
- `.env` files containing secrets
- Browser profiles, local-storage exports, or Firebase CLI login tokens

The committed Firebase web configuration is intentionally excluded from this list because it is public configuration protected by Authentication and Firestore security rules.

