---
name: Timecard
description: A warm and dependable attendance workspace
colors:
  primary: "#235cbd"
  primary-hover: "#194a9d"
  blue-surface: "#ecf3ff"
  ink: "#26354b"
  muted: "#667184"
  paper: "#fff"
  canvas: "#f8f9fc"
  line: "#e8ebef"
  amber: "#f0be60"
  green: "#287b60"
typography:
  body:
    fontFamily: "DM Sans Variable, sans-serif"
  heading:
    fontFamily: "Manrope Variable, sans-serif"
rounded:
  control: "8px"
  panel: "11px"
  dialog: "14px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "23px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
---
# Design System: Timecard

## Overview

The confirmed Caregiver direction is warm, friendly, calm and dependable. Blue primary actions, light blue surfaces and restrained amber accents carry that commitment into the source styles. White panels and quiet dividers organize attendance data.

This record follows app/globals.css, app/layout.tsx, app/timecard.tsx and app/workspace-controls.tsx. The final rendered review approved the sampled UI, subject to the final production rebuild still pending. Refreshed desktop, 360px mobile, map and profile views were opened; .impeccable/review/checks.json reports no page errors and zero axe violations across five sampled surfaces. A prior production build passed. This scoped review is not full WCAG certification and does not validate live AWS face verification, email or SSO integrations.

The map showed an explicit loading status; external tile loading was not confirmed. Enter and Space did not move the map pin. The table scroller positioning rule was verified in the browser and saved to source to keep the visually hidden header bounded by its scroller.

**Key Characteristics:**

- Blue actions and light blue supporting surfaces.
- White panels, fine borders and compact attendance tables.
- Rounded controls with visible keyboard focus.

## Colors

Primary blue identifies actions; its darker companion is the primary button hover state. Pale blue supports the visual direction, with individual care and clock panels using local tints. Amber is the reserved warm accent. Green supports positive status styling; badges use their own local shades.

Paper is used for navigation, panels and controls; canvas sits behind them. Ink, muted and line provide the root neutral roles. Many small labels use a separate hardcoded slate (#59687d), so muted is not a universal label color. Status badges also use amber, purple and red local pairs with text labels.

## Typography

DM Sans Variable is the body family; Manrope Variable is used for headings and the brand. Both are self-hosted through @fontsource-variable imports in app/layout.tsx, with sans-serif fallbacks. Global h1 is (30px, weight 750, line-height 1.3, tracking -1.05px); page headings override it. Global h2 is (18px, weight 750, line-height 1.45); h3 is (15px, weight 700, line-height 1.5). Paragraph line-height is (1.7). The later readability rules set navigation to (13px), key dashboard labels and details to (11-12px), table headers to (11px), and table/footer metadata to (10px). Some context-specific smaller text remains; observed sizes do not establish accessibility approval. Numeric tables, statistics and elapsed time use tabular numerals.

## Layout

The desktop shell has a fixed (244px) sidebar and a main region capped at (1600px). Main content initially uses (37px) padding. Summary cards form four columns; the dashboard pairs its main column with a (278px) secondary column. Spacing is context-specific: there is no implemented global spacing scale.

At max-width (1150px), navigation narrows to (215px). At max-width (950px), dashboard columns collapse, summary cards become two columns and the care panel is hidden. At max-width (700px), navigation becomes an off-canvas drawer, clock content stacks and page padding becomes (20px). Tables retain minimum widths inside horizontal scroll containers. At min-width (1450px), desktop spacing and selected type sizes increase. Dialogs constrain width to the viewport and scroll vertically. The shell clips horizontal overflow while table containers retain local scrolling. On small screens, the closed navigation is inert; when open it makes the app body inert, moves focus into the menu, traps Tab, closes on Escape, and restores focus to the menu trigger.

## Elevation & Depth

Panels use borders and tonal layering without a resting shadow. Dialogs and notification popovers use the root shadow (0 14px 50px #1d35531a); toasts use (0 8px 30px #1439571a). Dialog backdrops dim and blur the background.

## Shapes

Controls have gently curved corners; panels are slightly rounder; dialogs and clock cards use the larger dialog radius. Small badges use (5px), icon buttons (7px), avatars are circular, and the landing preview uses (20px). The root --radius is (14px), but component rules mostly specify radii directly.

## Components

Buttons share inline-flex alignment, (13px) text and weight (600). Standard buttons have a (41px) minimum height and white background; primary uses blue and white. Compact and large variants alter padding and minimum height; danger uses red. Hover transitions cover background and shadow over (.15s). Disabled buttons reduce opacity to (.55).

Inputs, selects and textareas use white surfaces, fine borders and a (44px) minimum height. Textareas have a (94px) minimum height and resize vertically. Interactive elements use a (3px solid #4988e6) focus outline with a (3px) offset.

Panels use the frontmatter primitives and a fine line border; mobile panel padding becomes (20px). Navigation items have (7px) corners, a pale hover surface and blue selected state. Status badges combine text, a small dot and tinted backgrounds. Tables use fine horizontal separators and subtle row hover backgrounds. Native dialogs provide the reusable modal container; face verification has a wider dialog override.

The location map supports pin placement by pointer or arrow keys; keyboard activation does not also trigger pointer-coordinate placement. Loading and tile failures have a status message, with a retry control and coordinate-entry fallback. Clock trust copy distinguishes verified check-in, verified check-out, manual approval and pre-check-in requirements using the available attendance fields.

The reduced-motion media query disables animations and transitions and restores automatic scrolling. The mobile sidebar otherwise transitions over (.2s).

## Do's and Don'ts

- Do preserve blue primary actions and restrained warm amber accents.
- Do reuse existing controls, panels and text-bearing status badges.
- Do retain keyboard focus and reduced-motion treatments.
- Don't invent a global spacing scale from context-specific measurements.
- Don't extend sampled UI approval into full WCAG certification or unverified live integration claims.

Final build status: the last rebuild compiled and passed type checks but failed during Next.js page collection (`no direct app page entry found for /_not-found`). Generated-output cleanup/retry was declined; final artifact verification remains outstanding. The sampled rendered approval above is unchanged.
