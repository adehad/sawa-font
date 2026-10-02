---
title: How Arabic marks are placed in a font
lang: en
---

# How Arabic marks are placed in a font

An Arabic word is not a row of fixed letter shapes with dots and vowels printed on top. The font holds several drawings of each letter, picks one for each place in a word, and positions every dot and mark with rules it carries inside. The demos here use Sawa Sans 400 itself (Noto Sans Arabic at 1.15 times beside Noto Sans), shaped live by HarfBuzz, the same shaping engine browsers and the font build use.

## One letter, four glyphs

Arabic letters join to their neighbours, and a letter's shape changes with how it joins: alone (isolated), joined only to the letter after it (initial), joined on both sides (medial), or joined only to the letter before it (final). A font draws each of these as a separate glyph. When text is set, the shaping engine looks at each letter's neighbours and the font's substitution table, GSUB, swaps in the right glyph: the `init`, `medi` and `fina` features hold one lookup each.

Noto Sans Arabic goes one step further. Its `ccmp` feature first splits a dotted letter into a dotless body and a dot glyph, so beh, teh, theh, noon and yeh can share one body in each form. Six letters of the alphabet (alef, dal, thal, reh, zain and waw), and teh marbuta and alef maksura, never join to the letter after them, so they have only two forms. Hamza has one.

```demo
forms letter=U+0628
```

## Anchors: where a mark meets its letter

A mark is a glyph of its own, with no width, drawn after its letter. The positioning table, GPOS, says where it goes with anchors: a point on the letter (the base anchor) and a point on the mark (the mark anchor). The engine moves the mark until the two points meet. A mark-to-base lookup holds every pair: for each letter glyph, one anchor per class of marks above, below or inside it.

Drag the cross, the letter's anchor for marks above. The fatha follows, because its own anchor, the ring, stays on the letter's.

```demo
anchor letter=U+0628 form=isolated mark=fatha
```

## Mark classes: one anchor, many marks

A letter does not have an anchor for each mark. It has one per class, and every mark in the class attaches to the same point. In Noto Sans Arabic the class above holds 90 marks: fatha, damma, fathatan, dammatan, shadda, sukun and most Quranic marks, and also the dots above. So moving one anchor moves all of them at once, on every letter drawn with that glyph.

Here the anchor for marks above on the initial body that beh, noon and yeh hamza share moves up. Beh's fatha rises, and so do noon's dot and the fatha on it, because they are in the same class. Beh's dot below does not move: it is in the class below, with its own anchor.

```demo
classes glyph=uni066E.init class=27.0 cells=U+0628|initial|fatha,U+0646|initial|fatha,U+0628|initial|kasra
```

This is why the lab shows a blast radius before an edit: an anchor is shared, and a change to it reaches further than the cell you are looking at.

## Stacking marks with mark-to-mark

When two marks sit above one letter, the second does not go to the letter's anchor, or it would land on the first. A mark-to-mark lookup gives the first mark an anchor of its own for the marks that stack on it. Shadda with fatha works this way: the fatha attaches to the shadda, and the shadda to the letter. So does a fatha over teh's two dots, which hangs on the dots.

Moving the shadda's stacking anchor lifts the fatha over every shadda, on any letter, and leaves the shadda where it is.

```demo
stack glyph=uni0651 class=35.0 cells=U+0628|medial|shadda-fatha,U+0633|initial|shadda-damma,U+0644|final|shadda-fatha
```

## One pair, one rule

Sometimes only one combination needs help, and moving a shared anchor would disturb everything else. A contextual positioning rule names a context and an adjustment: "fatha, when it follows the medial beh body, moves down 40 units." In feature syntax:

```fea
lookup lab_pair_uni064E {
  lookupflag UseMarkFilteringSet [uni064E];
  pos uni066E.medi uni064E' <0 -40 0 0>;
} lab_pair_uni064E;
```

The mark filtering set tells the rule to skip every mark except fatha, so a shadda or a dot between the letter and the fatha does not break the match. The rule goes in a lookup after the anchors have done their work, so it adjusts the fatha where it already is. A mark stacked on the adjusted one keeps its height.

```demo
pair base=uni066E.medi mark=uni064E cells=U+0628|medial|fatha,U+0628|initial|fatha,U+0646|medial|fatha
```

The rule still reaches every letter drawn with that body, here noon medial as well as beh medial, but nothing else.

## A form of its own

When no move fixes a combination, a font can draw it as a glyph of its own and swap it in with a contextual substitution in GSUB. Noto Sans Arabic does this for lam followed by alef: its `rlig` feature replaces both with a pair of glyphs drawn to make the lam-alef. It also has a single glyph for shadda with kasratan, which its `ccmp` feature puts in place of the two marks.

```demo
substitution texts=لا,لـا,ثٍّـ
```

Amiri, a naskh font, uses this much further. Its substitutions pick stacked forms for letter and mark combinations depending on the letters around them, and position marks for each such form. Each of those forms is a glyph a designer drew. In the lab, "Needs its own form" records a request for one, with the reason and the change you want; the glyph is derived later, not by dragging.

## Dots are part of the letter

Dots are not tashkeel. They tell letters apart: beh, teh and theh differ only in their dots. In Noto Sans Arabic most dots are glyphs of their own that `ccmp` splits off and that attach through the same anchors as marks; some are drawn inside the letter's outline. Either way, moving a letter's outline in glyf moves its anchors with it, so its dots and marks come along. A dot glyph can also be moved alone, by drawing a copy and swapping it in after that one letter.

```demo
dots letters=U+0628,U+062A,U+062B,U+0646,U+062C
```

## What makes Sawa hard

Sawa sets Arabic beside Latin at one point size, and asks the Arabic to read as large as the Latin. Noto Sans Arabic is drawn smaller for the same size, so Sawa scales it by 1.15. The Arabic gets taller, and so does every stack of marks on it.

```demo
scale latin=Hxgy arabic=عربيّة
```

The line box has to hold both scripts, and the tallest and deepest everyday stacks set its height. Theh initial with shadda and kasratan reaches 1.50 em above the baseline, and yeh with kasratan 0.80 em below it: 2.30 em in all, against 1.18 em for the Latin. The owner approved a 2.06 em box instead, from 1.44 em to -0.62 em, placed so that 99.4% of the words in the project's sentences and the Quran text fit inside it. The few tallest and deepest stacks pass it on purpose, as these two do.

```demo
envelope texts=ثٍّـ,يٍ,Hxgy
```

Within that box, everyday tashkeel must not touch: no mark may come closer than 0.03 em to its letter, its dots or another mark. Marks keep their full size, and the box is not made taller to make room.

And the source is the default. Noto's own placement is kept, and every change is made at the smallest scope that fixes the problem: a pair rule before a split class, a split class before an anchor, an anchor before an outline. That is the order the lab offers its scopes in.
