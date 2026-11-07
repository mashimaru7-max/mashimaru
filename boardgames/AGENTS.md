# Board game UI conventions

Follow the user's supplied layout and interaction reference: responsive and card-based layout, tabs for peer views, accordions for secondary settings, clear dropdowns, modal dialogs, brief feedback, consistent hover/press/selection states and smooth restrained transitions. Treat this as the baseline for this hub and future games. Share theme.css and ui.js; keep per-game rules separate. Favor clear card layouts, consistent selected states, native modal dialogs with Escape and focus return, brief toasts, subtle hover/press feedback and reduced-motion support. Mobile interactions must work without hover. Keep gameplay readable within the viewport on phones and landscape screens; allow settings and help to scroll. Never apply every reference effect indiscriminately. Preserve existing Blitz routes, family names, adjustable order, 60-card packs, direct winner selection, undo and final-duel-before-results behavior.


## Nunsongi mascot
The board-game mascot is the user's crested gecko 눈송이: caramel brown head, cream dorsal stripe, chocolate flank markings, eyelash crests, pale curled tail. Reuse assets/nunsongi.webp for new games. Keep original pet photos out of the public repository. Use the mascot in welcoming, waiting, help and celebration moments, with concise contextual copy. Avoid covering playable cards, symbols, controls or score text; hide waiting art when a card is revealed. Respect reduced motion and decorative alt="" for repeated illustrations.

## Catalog artwork
Keep game-selection covers in the illustrated Nunsongi mascot style, with thematic outfits and props. Use assets/nunsongi-football.webp for the Suwon lineup cover. Human player and coach photography belongs inside the lineup game, not on its catalog cover.
