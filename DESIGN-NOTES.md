# Ervo design notes: iPhone and Android

What Ervo follows from Apple's Human Interface Guidelines and Samsung's One UI design system, and how each rule shows up in the app. Ervo is one web app (docs/app) that runs as a home-screen app on iPhone and inside the Android app's WebView, so most rules are met once, in CSS and JS. The Android-only parts live in the Kotlin app.

## The phones

| Phone family | Screen width (CSS px / dp) | What to plan for |
|---|---|---|
| iPhone SE, 12/13 mini | 375 | Smallest screen still in use. Everything has to fit at 375 wide. |
| iPhone 14–16, 16e | 390–393 | Dynamic Island on 14 Pro and later, notch on others. |
| iPhone 16 Pro, 17, 17 Pro | 402 | Dynamic Island. |
| iPhone Air | 420 | Dynamic Island, thin and tall. |
| iPhone Plus / Pro Max | 428–440 | One-handed reach is hard; keep actions low. |
| Galaxy S (S24–S26) | 360–412 | Punch-hole camera, curved or flat edges. |
| Galaxy Z Flip (cover screen) | small, about 260–340 | Ervo opens there too; keep it usable. |
| Galaxy Z Flip (open) | about 412, very tall | Flex mode when half folded. |
| Galaxy Z Fold (cover) | about 344–390 | Narrow and tall. |
| Galaxy Z Fold (open) | about 670–880 | Medium/expanded size class. Use the extra width. |
| Galaxy Tab, iPad | 768 and up | Expanded size class. |

Size classes (Samsung, Android): compact under 600dp, medium 600–839dp, expanded 840dp and up. Apple says to lay out by available space, not by device type. Ervo uses the same breakpoints.

## Rules Ervo follows, and where

### Text and touch
- Body text is 17pt on iPhone by default and never below 11pt (Apple). Ervo's smallest labels were 10–10.5px; they are now at least 11px.
- Text must scale with the phone's text-size setting up to 200% (Apple Dynamic Type, One UI scalable text). iPhone: Ervo reads the Dynamic Type body size and sizes everything from it, up to 2×. Android: the WebView follows the phone's font size up to 200% (it was capped at 115%).
- Touch targets at least 44×44pt (Apple) with room between them (Samsung). Chips, action buttons and small header buttons were 34–38px; they are now 44px, or have a 44px hit area.
- Buttons show a pressed state, and keyboard focus shows a ring (Samsung focus mark, Apple Full Keyboard Access).

### Color, Dark Mode and contrast
- Follow the phone's light/dark setting; don't add an app-only appearance switch (Apple settings guidance, One UI themes). The sun/moon button is gone. Asking Ervo for dark mode now points to the phone's display settings.
- Text contrast at least 4.5:1 (both). With Increase Contrast (iPhone) or high-contrast fonts, Ervo darkens secondary text and borders.
- Don't use color alone to show state (both). Picked choices get a check mark, not just a color.

### Motion
- Honor Reduce Motion (Apple) and keep animations between 100 and 500ms (Samsung). With Reduce Motion on, Ervo stops bouncing, sliding and glowing, but spinners keep turning so the app never looks frozen (Apple: keep progress indicators moving).
- One UI's easing curve, cubic-bezier(0.22, 0.25, 0, 1), is used for Ervo's sheets and drawers.

### Launch
- The launch screen should look like the first screen, with no logo, and open fast (Apple). Ervo used to show its logo for 1.1 seconds on every start. Now it opens straight to the chat, and the Android window starts in the chat's own gray so there is no white flash.

### Sheets, menus and gestures
- Sheets have a grabber and can be swiped down to dismiss (Apple). Choice and confirm dialogs sit at the bottom of the screen (One UI).
- Touch and hold on Ervo's reply opens a small menu with Copy and Ask again (Apple generative AI guidance: let people copy, retry and refine results; One UI: touch and hold opens a context menu).
- On iPhone, swiping in from the left edge goes back, like every other iPhone app. Android already has its own back gesture, so Ervo doesn't add one there.

### Haptics
- Use haptics sparingly and only for clear cause and effect (both). Ervo on Android taps lightly when you send, ticks when you pick an answer, buzzes on touch and hold, and gives confirm or reject feedback for done/failed actions. It uses Android's own haptic feedback, so it follows the phone's "Touch feedback" setting.

### AI
- Say where AI is used and that it can make mistakes (Apple). The menu says so.
- Show specific progress ("Looking at your photo"), not "Loading" (Apple). Ervo already does this.
- Ask before anything irreversible or that spends money (Apple). Ervo never pays or checks out, and asks before deleting events.
- Explicit feedback should change behavior right away and be remembered (Apple machine learning). Psyche does this.

### Writing
- Say how to fix a problem, never blame the person, no "Oops" or "Error" (both). When the phone is offline, Ervo now says so and what to do, instead of a general "couldn't reach" message.
- Use "you", plain words and the singular "they" (both).

### Screen readers
- New messages are announced (the chat is a live log). Icon buttons have labels. Messages in right-to-left languages like Arabic or Hebrew line up the right way.

### Foldables and large screens (Samsung)
- Apps must resize, support landscape and keep their place when the phone folds or unfolds. Ervo keeps the WebView alive through size changes, so your scroll position and typing stay put.
- At 840dp and wider (Z Fold open in landscape, tablets), the Chats list stays open beside the chat instead of sliding over it.
- Flex mode (half-folded Z Flip or Fold): messages stay on the top half, and the message box and suggestions move to the bottom half, away from the crease.

### Android system features
- App shortcuts: touch and hold the Ervo icon for Talk to Ervo, New side chat, Ideas and Psyche (Apple calls these quick actions; Android calls them app shortcuts).
- Themed icon: on Android 13 and later, Ervo's icon can follow the wallpaper colors when themed icons are on.

## Not done yet (needs a native iPhone app)
- Siri, App Shortcuts, widgets, Live Activities and Home Screen quick actions on iPhone all need a native iOS app. The iPhone version is a home-screen web app, so it can't offer them yet.
- Liquid Glass is a native iOS material. Ervo's floating header and composer fade over the chat instead.
- iPhone haptics: home-screen web apps can't play haptics on iPhone.
