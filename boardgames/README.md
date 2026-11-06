# 마루 보드게임

- Hub: `/boardgames/`
- Blitz: `/blitz/` (existing URLs preserved)
- `games.js`: game catalog; add an entry with a unique id, title, subtitle, description, href, players, tags, status, and art.
- Each game keeps its own rules, state and assets in its route. The hub never loads game logic.
- `shared/theme.css`: shared color, typography, buttons, focus, dialogs and reduced-motion behavior.
- `shared/ui.js`: toast, Promise-based confirmation and modal backdrop behavior.
- `AGENTS.md`: durable interaction conventions transcribed from the user's reference; the original reference image is not published.

Add a game by creating a separate route and registering it in `games.js`. Reuse the shared theme and interactions. For a new artwork style, add its scoped art class to `style.css`. List only implemented games with `status: 'available'`. Do not create clickable placeholder games.
