# Tanzil Quran text

`quran-uthmani.txt.gz` is the full Uthmani download below, byte-exact with
its complete copyright block, gzipped (`gzip -9 -n`). Uncompressed, its
sha256 is `0fa31b4f07d72bf85e8052575a33315566322eb905bef7d839b100ac0ef7b683`.
`sawa_tools.tanzil.uthmani()` returns its 6236 verse lines.

`uthmani-fatiha.txt` and `simple-clean-fatiha.txt` are Al-Fatiha 1:1-7 (the
first 7 lines of the full downloads below), copied byte-exact, followed by a
blank line and the source file's complete copyright block, also byte-exact.

## Source

Fetched 2026-09-28 from tanzil.net, with the default download options
(no "different tanween shapes" option; see `SAWA_PLAN.md` section 8.1).

| Variant | URL | sha256 of the full download |
|---|---|---|
| Uthmani | `https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt&marks=true&sajdah=true&rub=false&tatweel=true&agree=true` | `0fa31b4f07d72bf85e8052575a33315566322eb905bef7d839b100ac0ef7b683` |
| Simple clean | `https://tanzil.net/pub/download/index.php?quranType=simple-clean&outType=txt&marks=true&sajdah=true&rub=false&tatweel=true&agree=true` | `1e524c2fdf2cdea8cfbf315a108d8590d2de73ab0eedb8194dfab065ac820e2b` |

## Terms of use (verbatim, from tanzil.net)

> Permission is granted to copy and distribute verbatim copies of the Quran
> text provided here, but changing the text is not allowed. The text can be
> used in any website or application, provided that its source (Tanzil
> Project) is clearly indicated, and a link is made to tanzil.net to enable
> users to keep track of changes.

The copyright block embedded in each download adds:

> This copyright notice shall be included in all verbatim copies of the
> text, and shall be reproduced appropriately in all files derived from or
> containing substantial portion of this text.

## Rule

These files must never be edited by hand, including to fix a typo or
reflow a line. If the upstream text changes, re-fetch it from the URLs
above, recompress it and regenerate the excerpts; don't patch a file in
place. `tests/python/test_tanzil.py` pins the full text and each excerpt's
verse lines and copyright block by sha256, so an edit fails CI.
