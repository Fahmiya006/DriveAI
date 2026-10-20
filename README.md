# DriveAI — AI Traffic Management & Driver Assistance (mobile app)

A phone-installable web app (PWA) built from the console demo. Sign in → enter start & destination →
drive (simulated or live GPS) with every module running on a real map → arrival summary with
driver + vehicle analytics.

## Put it on a phone

Phones only allow GPS, install-to-home-screen and service workers on **HTTPS**, so host the folder:

1. **Fastest:** drag this whole folder onto https://app.netlify.com/drop (or Vercel / GitHub Pages / Cloudflare Pages).
2. Open the https URL on the phone.
   - Android Chrome: menu → *Install app*.
   - iPhone Safari: Share → *Add to Home Screen*.

Local test on a computer: `npx serve .` (or `python3 -m http.server`) and open http://localhost:3000 (or :8000).

Demo login: `demo@driveai.app` / `demo123` (or create an account / continue as guest).

## What works

| Area | Behaviour |
|---|---|
| Login | Sign in / create account / guest. **Stored on the device only** (SHA-256 hashed) — swap for your Node API + MongoDB for real accounts. |
| Maps | Leaflet + OpenStreetMap tiles, Nominatim place search, OSRM routing with up to 3 alternatives. Route coloured by congestion. "Open in Google Maps" button on the plan and summary screens. |
| Planner | Start (type, ◎ my location, 📌 pick on map) → destination, AI-ranked ETAs, best-time-to-leave forecast, vehicle type. |
| Live trip | Turn-by-turn card, voice guidance, speed + detected speed-limit sign, signal state/countdown, live safety score, ETA. Tabs: Map · Camera · Junction · Events. |
| Road safety | Lane-change/overtake, forward-collision warning, pedestrian yield, signal stop, speed-breaker alerts, lane departure, distraction alert. |
| Compliance | Speeding and red-light violations logged with time + road name. |
| Traffic intelligence | Adaptive signal timing (green advance/extend), emergency-vehicle green corridor (🚑), congestion jam → auto-reroute (OSRM alternate), manual 🧭 reroute, demo-speed (1×/4×/8×/16×), night mode. |
| Arrival | Driver tab (score, grade, stars, behaviour bars, events, rate trip, violations), Vehicle tab (distance, speed, idle, fuel, CO₂, cost, eco score, speed chart, vehicle health), AI-impact tab (adaptive vs fixed-time). Saved to **Trips**. |

## Honest limits (read before demoing as "real")

- **Detections are simulated.** There is no camera/YOLO input in the browser; signals, speed limits, pedestrians, lead vehicles, violations and OBD-style vehicle health are generated along the route so the whole flow can be demonstrated. The real pipeline (camera → YOLOv8 → Node API → MongoDB) plugs in behind the same screens.
- **Congestion is modelled**, not live traffic. For live traffic swap OSRM for Google Directions / Mapbox / HERE.
- **Live GPS (beta)**: Profile → Live GPS navigation. Uses real position/speed for navigation and analytics; scenario events are turned off (they would be fake).
- Public OSRM/Nominatim servers are for demos. For production run your own or use a paid provider.

## Switching to Google Maps

You asked for Google Maps *or* another map; this build uses OpenStreetMap so it works with no API key or billing.
To use Google: create a Maps JavaScript + Directions + Places key, replace `makeMap`, `fetchRoutes`, `suggest` and the polyline drawing in `app.js` (they're isolated in the "MAPS" and "PLAN" sections).

## Files

`index.html` · `styles.css` · `app.js` (login, maps, trip, analytics) · `engines.js` (junction + dashcam engines from the console) · `manifest.json` · `sw.js` · `icon*`
