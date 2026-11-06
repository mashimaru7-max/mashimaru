# 왓더벅 · 눈송이의 몸짓 극장

An unofficial family adaptation of the public feature+animal charades format. Original prompts and generated artwork; no official card scans, rulebook text, logo or product art are shipped.

Rules: 3–6 players each act three times; each other player guesses at most once per turn. Human actor judges answers. Actor and solver receive a token on success. Two players alternate for ten shared attempts. Family variants: six original illustrated bugs; replace only the one or two used cards after every resolved turn, on success or failure; retain all unused cards; consumed prompts do not return in that game; independent equally likely 1/2/3-star rewards, revealed at the end. No finite original token bag is claimed. No mandatory timer.

`engine.js` holds pure state transitions and CommonJS exports for tests. `data.js` holds original Korean prompt pools and illustrated bug ids. `app.js` handles dialogs, private reveal, once-only settlement, undo and tab-scoped session restoration. `style.css` uses the shared board-game theme and responsive illustrated theater.

Privacy: secret values are rendered only inside the reveal dialog, cleared on close and hidden when the tab loses visibility. This is pass-and-play on one device, not authenticated multiplayer. SessionStorage preserves game state to avoid rerolls, so this is visual concealment rather than protection from developer tools.

Art briefs: stage.webp — painted plum-curtain twilight woodland theater with empty center. bugs.webp — six illustrated insect sprites on a 3×2 transparent grid: ladybug, butterfly, bee, ant, spider, grasshopper. Built-in image generation; WebP encoding for web. Nunsongi mascot reused from ../boardgames/assets/nunsongi.webp.

Checks: `node --test what-the-bug/tests/*.test.cjs` from the repository root.
