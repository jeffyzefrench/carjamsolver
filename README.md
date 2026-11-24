# Car Jam Solver 3D

An ad-free, offline-ready **Progressive Web App (PWA)** traffic & bus jam puzzle game built with **Three.js**, **TypeScript**, and **Vite**.

Tap unblocked vehicles in a crowded parking lot to navigate them around the perimeter road into limited holding slots, pick up color-matched passengers from the boarding queue, and clear the lot — with **150+ solver-verified levels**, rotating multi-lane passenger carousels, and free player-friendly recovery options.

## Features

- **150+ Verified Solvable Levels (+ Endless Mode)**: Deterministic seeded puzzle generation verified by an automated Vitest solver (`5` base holding slots, `100%` color-to-seat parity, zero overlaps).
- **Evolving Mechanics**:
  - **Multi-Size Vehicles**: 4-seat Sedans (`1×2`), 6-seat Vans (`1×2`), and 8-seat Buses (`1×3`).
  - **Underground Garages / Tunnels**: Dispense queued vehicles when the spaces in front clear.
  - **Mystery (`?`) Vehicles**: Concealed colors revealed when an orthogonally adjacent vehicle exits.
  - **Ice-Frozen Vehicles**: Encased in ice with a countdown that ticks down each time another vehicle escapes.
  - **Rotating Multi-Lane Passenger Carousel**: Splits incoming passengers across 2–3 feeder lanes feeding into a central rotating boarding hub as you progress.
- **Dynamic Color Themes**: Cycles across 5 visual themes (*Daylight Metro*, *Sakura Park*, *Coastal Boardwalk*, *Sunset Canyon*, *Alpine Frost*) every 10 levels.
- **100% Ad-Free & Player-Friendly**:
  - Unlimited free **Undo**, **+1 VIP Slot** (up to 7 total slots), **Resort Queue**, and **Instant Restart**.
  - Free **Continue** recovery modal when holding slots fill up.
  - Free **Unlock All 150 Levels** sandbox toggle in the level selector.
- **Offline PWA + Procedural Audio**: Precached via `vite-plugin-pwa` with zero external audio assets (Web Audio API synthesizer).

## Getting Started

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Run 150-level solvability & parity test suite
npm test

# Build production PWA (outputs to dist/)
npm run build
```

## Tech Stack

- **3D / 2.5D Rendering**: [Three.js](https://threejs.org/)
- **Language & Build**: TypeScript, [Vite](https://vite.dev/), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)
- **Testing**: [Vitest](https://vitest.dev/)
