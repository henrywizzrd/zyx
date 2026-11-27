# ZYX roadmap (beta)

Working notes for what's next. Agreed items are done one at a time on the `beta` branch, tested in ZYX Beta, then batched into the weekly stable update.

## Release rules (agreed 24/11)
- Stable gets about **one update a week**. Updates download quietly and apply the next time the app opens.
- `[hotfix]` / `[critical]` only for bugs that stop people listening; those still ask to restart right away.
- The weekly stable update is a `[stable]` commit on main: production OTA, applied quietly (no popup, no GitHub Release).

## 1. Use less memory, keep the same animations
Goal: old / low-RAM phones (iPhone 8 Plus, 3 GB) stop getting closed by iOS in the background, without changing how the app looks or moves. Animations themselves cost almost nothing; memory goes to what is drawn.

Steps, lowest risk first:
1. **Audit (read only):** list every place that holds images, glass/blur layers, Skia canvases and pre-built tabs, with a size estimate for each.
2. **Right-sized images:** vinyl label, cover art and theme backgrounds decoded at the size shown on that phone (the vinyl label is drawn at 1280 px today, about 6.5 MB).
3. **Free memory in the background:** clear the image memory cache and unmount the vinyl player / background effects while only audio plays; rebuild on return.
4. **Background effects at half resolution:** smoke, aurora and rain are soft shapes, so drawing the Skia canvas at 0.5× and scaling up looks the same for about ¼ of the memory.
5. **Fewer glass layers:** merge neighbouring blur areas and trim each to the part that is actually visible.
6. **Don't keep all four tabs forever:** release tabs that haven't been opened for a while.
7. **Image cache limit** for the image library.

Open question: logs only measure JS memory. iOS closes apps by total memory, so we still need a way to log the app's total footprint (check whether this is possible without a new native build).

## 2. Playback session at startup
Logs from 23/11 (iPhone 8 Plus: 11 s freeze, 264 MB; Galaxy S21 FE: 6.4 s, 176 MB) line up with preparing the playback session (downloading and running YouTube's player code). Startup now logs JS memory before/after and player-cache hit/miss. When the data confirms it, options are a server-side step on Supabase or running it off the JS thread. Discuss before building.

## 3. Music stopping on its own in the background
Log 24/11 00:40 (beta, 8D on): the song stopped at 193/205 s while the app was in the background and never resumed. The app did not pause it: expo-audio on iOS pauses on an audio interruption (call, notification sound, Siri, alarm) and resumes only if iOS says so, and pauses when headphones / Bluetooth disconnect. The log now marks these as "dừng không phải do app". Next: find out which case it is, then decide whether to resume after interruptions.

## 4. Ideas saved for later (24/11)

### Admin page (Tyson is the only admin)
- An admin role in the app; only the admin account sees a separate Admin page.
- **User list:** every user by username only (never email or password), with their device model.
- **Health light per user:** green = fine, yellow = minor errors now and then, red = crashes. Lets us spot which devices crash often and optimise for them.
- **Tap a user** to open their logs.
- Notes for when we build it: logs then go to our server automatically, so this follows the "Send crash reports" switch and needs a clear line in the privacy text; the admin check must live on the server (Supabase row-level security), not only in the app.

### Home redesign (planned for Friday 27/11)
Tyson shared 4 reference shots (25/11, from TikTok @webdesign.ui; not stored in the repo). What to borrow from each:
- **Warm health app (coral/pink):** one huge number in light type ("84/100") under a thin arc gauge, a short friendly sentence above it, translucent cards on a soft gradient, a round pill-shaped bottom nav, white pill buttons.
- **Hotel app (teal mountains):** a full-bleed photo behind everything with a tint, "Hello Sindy" greeting with avatar and bell, round filter chips in a row, horizontal photo cards with a small overlay label, "See all" on each section.
- **Tennis app (deep blue):** big two-line headline over a hero image, a row of two stat chips, a stats card with a smooth line chart, list rows with a round play button, a thin weekly progress bar.
- **Cycle app (soft pink):** one-colour palette from light to dark, Day / Month switch, a bar chart with the selected day highlighted, insight rows with tiny sparklines, an image card with a short call to action.

How that could map onto ZYX Home (to confirm on Friday):
- **Hero:** the current song's cover as a tinted full-bleed backdrop (we already compute 4 colours from the cover), greeting + avatar, and one big number such as minutes listened this week.
- **Chips:** moods / genres / "Downloaded" as round chips.
- **Carousels:** Recently played, Your mixes, New for you as photo cards with a frosted label.
- **Listening card:** this week's listening as a bar chart (Day / Week switch), today highlighted; doubles as a teaser for ZYX Wrapped.
- **Rows:** quick picks as list rows with a round play button.
- Colours follow the user's theme, so every theme gets its own version of this look.

Friday plan:
1. Look at the current Home code and data (what each section shows, what stats we have).
2. Make 2–3 mockups in Claude Design for Tyson to pick from (no code yet).
3. Build the chosen one on beta, a section at a time, and test it in ZYX Beta.
4. Keep the memory plan in mind: images at display size, few blur layers, no extra always-running animations.

### ZYX Wrapped (year in review, like Spotify Wrapped)
- Asked for by a user on Discord.
- Story-style screens from the listening history: minutes listened, top songs / artists, most-replayed song, plus a shareable image.
- Check first what the play history stores (e.g. real time listened). New users this year will have a thin recap.
- Could ship with the early-December update.

## 5. Later
- Christmas effects
- Background downloads, smaller downloads (audio-only blocked → 360p video, up to 185 MB per song)
- Search / Library jank; 1–2 s JS freeze after closing the player and switching tab
- Android: slow tab switches and high memory on mid-range phones
- Import from YouTube Music, Spotify, SoundCloud, Apple Music (announced for early December)
- Local music files (FLAC/ALAC; EAC3-JOC to be tested)
- Staged rollouts and an automated test on a low-end Android emulator
