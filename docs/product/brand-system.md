# Barion brand system

## Promise

**Medical learning, for real life.**

Tagline: **Learn today. Heal tomorrow.**

Barion should feel clinically trustworthy, calm, modern, and encouraging. Evidence and user control are part of the product identity, not secondary metadata.

## Source assets

- `app/image/BARIONLOGO.png` — supplied logo/wordmark.
- `app/image/BARIONTHEME.png` — supplied visual direction and palette reference.

Do not distort, recolor, or redraw the supplied mark. Runtime cropping in `BrandMark` isolates the monogram while retaining the original asset.

## Core tokens

| Role | Value |
|---|---|
| Deep blue | `#0F2D60` |
| Sky blue | `#3B82F6` |
| Mint teal | `#14B8A6` |
| Soft blue | `#E8F4FF` direction, tuned to `#EEF6FF` for UI surfaces |
| Slate gray | `#94A3B8` |
| Canvas | `#F6F9FD` |
| Typeface | Plus Jakarta Sans |

## Interface principles

1. Lead with the next useful action, not system terminology.
2. Show source provenance beside the learning content it supports.
3. Never present an unreviewed draft as a verified medical fact.
4. Use blue for primary action, teal for evidence/trust, and coral only for destructive or difficult states.
5. Keep touch targets at least 48 points high and allow layouts to stack on narrow screens.
6. Every background process needs a plain-language state, progress cue, retry path, and specific failure message.
