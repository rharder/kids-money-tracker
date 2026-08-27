# Family Money Tracker

A private, installable family ledger for teaching kids how to divide and manage money, backed by Firebase so the family sees the same balances on every device.

## What it does

- Adds a separate ledger for each child
- Shows Short Term and Long Term balances for every child at a glance
- Records spending from Short Term or Long Term directly from the family dashboard
- Adds the entered weekly-pay amount to each tracked category: Short Term, Long Term, and Very Long Term; Pocket and Tithe remain untracked
- Keeps Very Long Term savings visible in a quieter child detail view and prevents it from being spent
- Keeps a complete transaction history
- Syncs through Cloud Firestore after Google sign-in
- Gives the family owner full editing access and approved Google accounts view-only access
- Exports and restores JSON backups, including backups from the earlier category model
- Keeps a local cache for resilient loading and works as an installable PWA

The first approved account becomes the family owner and moves the existing browser data into Firestore. The owner can add or remove view-only Google accounts from **Account → Family access**. Firebase security rules enforce the same access on the server; hiding controls in the interface is not the security boundary.

The Firebase web configuration in `firebase-config.js` identifies the public Firebase project and is safe to ship to browsers. Access is protected by Google Authentication and `firestore.rules`, not by treating that configuration as a secret.

## GitHub Pages

The repository includes a GitHub Actions workflow that publishes the site whenever `main` is updated.

Google Authentication must list `rharder.github.io` as an authorized domain. Firestore is stored in the `nam5` U.S. multi-region.

## Screenshot demo

Open [`?demo=1`](https://rharder.github.io/kids-money-tracker/?demo=1) for a read-only set of fake kids, balances, and activity. Demo mode does not read, upload, or modify the real family tracker.
