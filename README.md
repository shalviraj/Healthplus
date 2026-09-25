# Healthplus

A phone-first daily health tracker. You add it to your home screen, it works offline, and it syncs to Google Sheets when you tap **Sync**.

- **Home:** date navigation, a 7-day strip (Weight / BP / Sugar), water intake, urine output, medicines (carried over from the previous day), labs, today's snapshot, the insulin chart, Sync, PDF and Settings.
- **Before BF / After BF / Before Lunch / Before Dinner:** sugar, BP, suggested insulin (from the insulin chart, editable), insulin given. Weight is on Before BF only. Every change saves automatically.
- **PDF:** choose a date range. The layout is Letter landscape with 8 days per page, a bold shaded Date row and the first column repeated on every page.
- **Google Sheet:** one column per date, matched by date, so syncing again never duplicates a day.

Export rows: Date, Day, Intake, Output, Weight, BP-Highest, BP-Lowest, BP Before BF, BP After BF, BP Before Lunch, BP Before Dinner, Fasting BS, PP, Before Lunch, Before Dinner, Steroid, Tac, VIRFOLI, Bactrim DS, Faronam 200, Udiliv 300, T0, Creatinine, Sodium, Potassium, Urea, Phosphorus, Calcium, HB, Platelet.

BP-Highest and BP-Lowest come from the day's four readings, compared by systolic. A tie goes to the earlier reading. BP-Lowest stays blank when only one reading was taken.

## Privacy

All data is stored on the phone (IndexedDB). It only leaves the phone when you tap Sync (to your own Google Sheet) or download a PDF or backup. **Never commit real patient data to this repo.** Tests use placeholder values only.

Browsers can clear site storage. Use **Settings → Export backup** now and then, and sync to the Sheet regularly.

## Setup

### 1. GitHub Pages
Repo **Settings → Pages → Build and deployment**: set Source to *Deploy from a branch* and Branch to `main` / `/ (root)`. The app is then served at `https://shalviraj.github.io/Healthplus/`.

### 2. Google Sheets sync (one time, about 5 minutes)
1. Go to https://console.cloud.google.com/ and create a project (e.g. "Healthplus").
2. **APIs & Services → Library**: enable **Google Sheets API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add yourself under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: choose *Web application*. Under **Authorized JavaScript origins** add `https://shalviraj.github.io`.
5. Copy the Client ID into `config.js` (`googleClientId`).
6. Put the Sheet ID (from the Sheet URL `/d/<ID>/edit`) in `config.js` (`sheetId`).

The first time you tap **Sync**, Google asks you to sign in and allow access. After that, Sync reuses the sign-in.

### 3. Install on the phone
Open the Pages URL in Safari (iPhone) or Chrome (Android), then choose **Share → Add to Home Screen** (or **⋮ → Install app**).

## Development
It's a static site with no build step:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # data-logic unit tests (Node 20+)
```

When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.
