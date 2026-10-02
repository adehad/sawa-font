"""Edge-case lines for each letter in Sawa Lab: short strings that put a
letter in each of its forms in the situations most likely to go wrong.

Three kinds, in the order the lab lists them:

- font: every alternate glyph the font's GSUB can turn the letter into,
  found by walking the Arabic lookups, each with the shortest string that
  triggers it, checked by shaping.
- situational: the letter after non-joining letters, between tall letters
  and descenders, after tails, with lam and lam-alef, beside tall mark
  stacks and with kashida.
- word: real words with the letter in each form, from the project's own
  sentences first and the Tanzil Quran text after them. Quran words are
  whole tokens of a verse, unchanged.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable

    from fontTools.ttLib import TTFont

FEATURES = ("ccmp", "isol", "init", "medi", "fina", "rlig", "calt", "liga", "clig")
FORM_SUFFIXES = ((".init", "initial"), (".medi", "medial"), (".fina", "final"))

TATWEEL = "ـ"
NON_JOINING = "ادذرزو"
TALL = "لكط"
DESCENDING = "جعمنيق"
SHADDA, FATHA, DAMMA, KASRA = "ّ", "َ", "ُ", "ِ"
# Arabic punctuation and digits trimmed from the ends of a word taken from
# the project's own sentences.
TRIM = "()[]«»\"'.,:;!?،؛؟-0123456789" + "".join(chr(0x0660 + i) for i in range(10))


@dataclass(frozen=True)
class Edge:
    """One substitution GSUB can make: `source` becomes `target`."""

    source: str
    target: str
    lookup: int
    feature: str
    context: str = ""


@dataclass
class Alternate:
    glyph: str
    lookup: int
    feature: str
    context: str
    via: list[str] = field(default_factory=list)


def _unwrap(lookup: Any) -> Iterable[tuple[int, Any]]:
    for subtable in lookup.SubTable:
        if lookup.LookupType == 7:
            yield subtable.ExtensionLookupType, subtable.ExtSubTable
        else:
            yield lookup.LookupType, subtable


def _mapping(lookup: Any) -> dict[str, list[str]]:
    """What a lookup used directly turns each glyph into."""
    out: dict[str, list[str]] = {}
    for kind, subtable in _unwrap(lookup):
        if kind == 1:
            for source, target in subtable.mapping.items():
                out.setdefault(source, []).append(target)
        elif kind == 2:
            for source, targets in subtable.mapping.items():
                out.setdefault(source, []).extend(targets)
        elif kind == 4:
            for first, ligatures in subtable.ligatures.items():
                for ligature in ligatures:
                    for source in [first, *ligature.Component]:
                        out.setdefault(source, []).append(ligature.LigGlyph)
    return out


def _sets(coverages: Iterable[Any]) -> list[set[str]]:
    return [set(c.glyphs) for c in coverages]


def _class_sets(
    class_def: Any, classes: Iterable[int], font_glyphs: set[str]
) -> list[set[str]]:
    defs = class_def.classDefs if class_def else {}
    out = []
    for cls in classes:
        if cls == 0:
            out.append({g for g in font_glyphs if defs.get(g, 0) == 0})
        else:
            out.append({g for g, c in defs.items() if c == cls})
    return out


def _context_rules(
    kind: int, subtable: Any, font_glyphs: set[str]
) -> Iterable[tuple[list[set[str]], list[set[str]], list[set[str]], list[Any]]]:
    """A contextual subtable's rules as (backtrack, input, lookahead, records)
    glyph sets, whatever its format.
    """
    fmt = subtable.Format
    if kind == 6 and fmt == 3:
        yield (
            _sets(subtable.BacktrackCoverage),
            _sets(subtable.InputCoverage),
            _sets(subtable.LookAheadCoverage),
            subtable.SubstLookupRecord,
        )
    elif kind == 5 and fmt == 3:
        yield [], _sets(subtable.Coverage), [], subtable.SubstLookupRecord
    elif kind == 6 and fmt == 1:
        for first, rules in zip(
            subtable.Coverage.glyphs, subtable.ChainSubRuleSet or [], strict=False
        ):
            for rule in rules.ChainSubRule if rules else []:
                yield (
                    [{g} for g in rule.Backtrack],
                    [{first}, *({g} for g in rule.Input)],
                    [{g} for g in rule.LookAhead],
                    rule.SubstLookupRecord,
                )
    elif kind == 5 and fmt == 1:
        for first, rules in zip(
            subtable.Coverage.glyphs, subtable.SubRuleSet or [], strict=False
        ):
            for rule in rules.SubRule if rules else []:
                yield (
                    [],
                    [{first}, *({g} for g in rule.Input)],
                    [],
                    rule.SubstLookupRecord,
                )
    elif kind == 6 and fmt == 2:
        covered = set(subtable.Coverage.glyphs)
        for cls, rules in enumerate(subtable.ChainSubClassSet or []):
            for rule in rules.ChainSubClassRule if rules else []:
                first = (
                    _class_sets(subtable.InputClassDef, [cls], font_glyphs)[0] & covered
                )
                yield (
                    _class_sets(
                        subtable.BacktrackClassDef, rule.Backtrack, font_glyphs
                    ),
                    [
                        first,
                        *_class_sets(subtable.InputClassDef, rule.Input, font_glyphs),
                    ],
                    _class_sets(
                        subtable.LookAheadClassDef, rule.LookAhead, font_glyphs
                    ),
                    rule.SubstLookupRecord,
                )
    elif kind == 5 and fmt == 2:
        covered = set(subtable.Coverage.glyphs)
        for cls, rules in enumerate(subtable.SubClassSet or []):
            for rule in rules.SubClassRule if rules else []:
                first = _class_sets(subtable.ClassDef, [cls], font_glyphs)[0] & covered
                yield (
                    [],
                    [first, *_class_sets(subtable.ClassDef, rule.Class, font_glyphs)],
                    [],
                    rule.SubstLookupRecord,
                )


def _describe(sets: list[set[str]], word: str) -> str:
    if not sets:
        return ""
    shown = []
    for glyphs in sets:
        names = sorted(glyphs)
        more = f" +{len(names) - 3} more" if len(names) > 3 else ""
        shown.append("[" + " ".join(names[:3]) + more + "]")
    return f"{word} {' '.join(shown)}"


def arabic_lookups(font: TTFont) -> list[tuple[int, str]]:
    """The GSUB lookups HarfBuzz applies to Arabic in the default language,
    as (lookup index, feature tag), in lookup order.
    """
    gsub: Any = font["GSUB"].table
    found: dict[int, str] = {}
    for record in gsub.ScriptList.ScriptRecord:
        if record.ScriptTag != "arab" or record.Script.DefaultLangSys is None:
            continue
        for index in record.Script.DefaultLangSys.FeatureIndex:
            feature = gsub.FeatureList.FeatureRecord[index]
            if feature.FeatureTag in FEATURES:
                for lookup in feature.Feature.LookupListIndex:
                    found.setdefault(lookup, feature.FeatureTag)
    return sorted(found.items())


def substitutions(font: TTFont) -> dict[str, list[Edge]]:
    """Every substitution the Arabic GSUB lookups make, by source glyph;
    a contextual one carries a description of its context.
    """
    gsub: Any = font["GSUB"].table
    lookups = gsub.LookupList.Lookup
    font_glyphs = set(font.getGlyphOrder())
    edges: dict[str, list[Edge]] = {}

    def add(edge: Edge) -> None:
        if edge.source != edge.target:
            edges.setdefault(edge.source, []).append(edge)

    for index, feature in arabic_lookups(font):
        lookup = lookups[index]
        for source, targets in _mapping(lookup).items():
            for target in targets:
                add(Edge(source, target, index, feature))
        for kind, subtable in _unwrap(lookup):
            if kind not in (5, 6):
                continue
            for back, inputs, ahead, records in _context_rules(
                kind, subtable, font_glyphs
            ):
                context = "; ".join(
                    part
                    for part in (
                        _describe(list(reversed(back)), "after"),
                        _describe(ahead, "before"),
                    )
                    if part
                )
                for record in records:
                    if record.SequenceIndex >= len(inputs):
                        continue
                    nested = _mapping(lookups[record.LookupListIndex])
                    for source in inputs[record.SequenceIndex]:
                        for target in nested.get(source, []):
                            add(Edge(source, target, index, feature, context))
    return edges


def reachable(start: set[str], edges: dict[str, list[Edge]]) -> dict[str, Alternate]:
    """Every glyph GSUB can turn the `start` glyphs into, each with the last
    lookup on the shortest path to it and the glyphs that path passes.
    """
    found: dict[str, Alternate] = {}
    queue = deque(sorted(start))
    seen = set(start)
    while queue:
        glyph = queue.popleft()
        for edge in edges.get(glyph, []):
            if edge.target in seen:
                continue
            seen.add(edge.target)
            before = found[glyph].via if glyph in found else []
            found[edge.target] = Alternate(
                edge.target,
                edge.lookup,
                edge.feature,
                edge.context,
                via=[*before, glyph],
            )
            queue.append(edge.target)
    return found


def form_of(glyph: str) -> str:
    for suffix, form in FORM_SUFFIXES:
        if suffix in glyph:
            return form
    return "isolated"


@dataclass
class Shaper:
    """uharfbuzz over one font, with glyph names and GDEF mark classes."""

    font_bytes: bytes
    names: list[str]
    marks: set[str]

    def run(self, text: str) -> list[tuple[str, int]]:
        """(glyph name, cluster) per glyph in logical order."""
        from sawa_tools import lab

        shaped = lab.shape(self.font_bytes, [ord(c) for c in text])
        return [(self.names[g[0]], g[1]) for g in reversed(shaped)]

    def letter_glyphs(self, text: str, index: int) -> list[str]:
        """The glyphs of the character at `index`, the ligature that took it
        in when it has none of its own.
        """
        glyphs = self.run(text)
        own = [name for name, cluster in glyphs if cluster == index]
        if own:
            return own
        earlier = [(c, n) for n, c in glyphs if c < index]
        if not earlier:
            return []
        last = max(c for c, _ in earlier)
        return [n for c, n in earlier if c == last]


def _letter_names(letters: list[dict[str, Any]]) -> dict[str, str]:
    return {letter["char"]: letter["name"] for letter in letters}


def font_lines(
    letter: dict[str, Any],
    letters: list[dict[str, Any]],
    marks: list[str],
    wanted: dict[str, Alternate],
    shaper: Shaper,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A line per alternate glyph a string with up to one neighbour on each
    side reaches, and the alternates none does, each with how GSUB gets
    there.
    """
    names = _letter_names(letters)
    char = letter["char"]
    neighbours = ["", *names, TATWEEL]
    found: dict[str, tuple[str, str, str]] = {}
    candidates: list[tuple[str, str]] = [("", "")]
    candidates += [("", n) for n in [*neighbours[1:], *marks]]
    candidates += [(p, "") for p in neighbours[1:]]
    candidates += [(p, n) for p in neighbours[1:] for n in neighbours[1:]]
    for before, after in candidates:
        if len(found) == len(wanted):
            break
        text = before + char + after
        for glyph in shaper.letter_glyphs(text, len(before)):
            if glyph in wanted and glyph not in found:
                found[glyph] = (text, before, after)
    lines, unreached = [], []
    for glyph, alt in sorted(wanted.items(), key=lambda kv: (kv[1].lookup, kv[0])):
        if glyph not in found:
            unreached.append(
                {
                    "glyph": glyph,
                    "lookup": alt.lookup,
                    "feature": alt.feature,
                    "context": alt.context,
                }
            )
            continue
        text, before, after = found[glyph]
        where = []
        if before:
            where.append(f"after {_neighbour(before, names)}")
        if after:
            where.append(f"before {_neighbour(after, names)}")
        situation = " ".join(where) or "alone"
        lines.append(
            {
                "kind": "font",
                "text": text,
                "label": f"{form_of(glyph)} {situation}: alternate glyph {glyph}"
                f" from lookup {alt.lookup} ({alt.feature})",
                "glyph": glyph,
                "lookup": alt.lookup,
                "feature": alt.feature,
                "context": alt.context,
            }
        )
    return lines, unreached


def _neighbour(text: str, names: dict[str, str]) -> str:
    if text == TATWEEL:
        return "kashida"
    if text in names:
        return names[text]
    return unicodedata.name(text, f"U+{ord(text):04X}").removeprefix("ARABIC ").lower()


def situational_lines(letter: dict[str, Any], shadda_ok: bool) -> list[dict[str, Any]]:
    """Fixed situations for the letter, in the forms it has."""
    c = letter["char"]
    dual = letter["joining"] == "dual"
    joins = letter["joining"] != "none"
    lines: list[tuple[str, str]] = []
    if dual:
        lines.append(
            (
                " ".join(f"{n}{c}ب" for n in NON_JOINING),
                "initial after non-joining letters " + " ".join(NON_JOINING),
            )
        )
        lines.append(
            (" ".join(f"{t}{c}{t}" for t in TALL), "medial between tall letters ل ك ط")
        )
        lines.append((f"ج{c}ن ح{c}ي م{c}ع", "medial between descending letters"))
    elif joins:
        lines.append(
            (
                " ".join(f"{n}{c}" for n in NON_JOINING),
                "isolated after non-joining letters " + " ".join(NON_JOINING),
            )
        )
        lines.append(
            (" ".join(f"{t}{c}" for t in TALL), "final after tall letters ل ك ط")
        )
    else:
        lines.append(
            (
                " ".join(f"{n}{c}" for n in "دلب"),
                "after joining and non-joining letters",
            )
        )
    if joins:
        lines.append(
            (" ".join(f"{t}{c}" for t in "جعم"), "final after letters with tails ج ع م")
        )
        lam = dict.fromkeys([f"ل{c}", f"ال{c}", f"{c}لا"])
        lines.append((" ".join(lam), "with lam and lam-alef"))
    stacked = (
        f"ب{SHADDA}{FATHA}{c}{SHADDA}{DAMMA}ب{SHADDA}{KASRA}"
        if shadda_ok
        else f"ب{SHADDA}{FATHA}{c}ب{SHADDA}{KASRA}"
    )
    lines.append((stacked, "next to tall stacks (shadda + vowel)"))
    if dual:
        lines.append(
            (f"{c}{TATWEEL * 3}ب بـ{c}ـب ب{TATWEEL}{c}", "with kashida U+0640")
        )
    elif joins:
        lines.append((f"ب{TATWEEL * 3}{c} ب{TATWEEL}{c}", "with kashida U+0640"))
    return [
        {"kind": "situational", "text": text, "label": label} for text, label in lines
    ]


@dataclass(frozen=True)
class Word:
    text: str
    corpus: str  # "mixed", "stress" or "tanzil"
    ref: str


def project_words(stress: Path, mixed: Path) -> list[Word]:
    """Arabic words from the project's own sentences."""
    words = []
    sentences = json.loads(mixed.read_text(encoding="utf-8"))["sentences"]
    for sentence in sentences:
        words += [
            Word(w, "mixed", sentence["id"]) for w in _arabic_words(sentence["text"])
        ]
    for test in json.loads(stress.read_text(encoding="utf-8"))["tests"]:
        text = test.get("purpose", {}).get("ar", "")
        words += [Word(w, "stress", test["id"]) for w in _arabic_words(text)]
    return words


_ARABIC_LETTER = re.compile(r"[ء-ي]")


def _arabic_words(text: str) -> list[str]:
    out = []
    for token in text.split():
        word = token.strip(TRIM)
        if len(_ARABIC_LETTER.findall(word)) >= 2 and all(
            "؀" <= ch <= "ۿ" or "ࢠ" <= ch <= "ࣿ" for ch in word
        ):
            out.append(word)
    return out


def quran_words(path: Path) -> list[Word]:
    """Each distinct whole-word token of the Tanzil Uthmani text, with the
    verse it first appears in.
    """
    from sawa_tools.tanzil import uthmani, verse_ref

    seen: dict[str, str] = {}
    for index, verse in enumerate(uthmani(path)):
        for token in verse.split():
            if len(_ARABIC_LETTER.findall(token)) >= 2:
                seen.setdefault(token, verse_ref(index))
    return [Word(text, "tanzil", ref) for text, ref in seen.items()]


def word_occurrences(
    words: list[Word], shaper: Shaper
) -> dict[tuple[str, str], list[tuple[Word, int]]]:
    """For each (letter, form or alternate glyph), the words and the index
    in them where that letter takes that form or glyph.
    """
    found: dict[tuple[str, str], list[tuple[Word, int]]] = {}
    for word in words:
        glyphs = shaper.run(word.text)
        by_cluster: dict[int, list[str]] = {}
        for name, cluster in glyphs:
            by_cluster.setdefault(cluster, []).append(name)
        for index, char in enumerate(word.text):
            own = [g for g in by_cluster.get(index, []) if g not in shaper.marks]
            if not own:
                continue
            body = own[0]
            for key in ((char, form_of(body)), *((char, g) for g in own)):
                found.setdefault(key, []).append((word, index))
    return found


def _rank(word: Word) -> tuple[int, int, int]:
    source = {"mixed": 0, "stress": 0, "tanzil": 1}[word.corpus]
    niche = sum(1 for ch in word.text if unicodedata.category(ch) == "Mn")
    return source, niche, len(word.text)


def word_lines(
    letter: dict[str, Any],
    occurrences: dict[tuple[str, str], list[tuple[Word, int]]],
    alternate_glyphs: Iterable[str],
) -> list[dict[str, Any]]:
    """A real word with the letter in each of its forms, and one for each
    alternate glyph a word reaches; project words before Quran words.
    """
    lines = []
    char = letter["char"]
    wanted = [(form, form) for form in letter["forms"]]
    wanted += [(glyph, f"alternate glyph {glyph}") for glyph in alternate_glyphs]
    used: set[str] = set()
    for key, label in wanted:
        hits = occurrences.get((char, key), [])
        choices = sorted({w for w, _ in hits}, key=lambda w: (_rank(w), w.text))
        word = next((w for w in choices if w.text not in used), None)
        if word is None:
            continue
        used.add(word.text)
        source = {
            "mixed": f"tests/strings/mixed.json {word.ref}",
            "stress": f"tests/strings/stress.json {word.ref}",
            "tanzil": f"Quran {word.ref} (Tanzil)",
        }[word.corpus]
        line = {
            "kind": "word",
            "text": word.text,
            "label": f"real word, {label}: {source}",
            "source": {"corpus": word.corpus, "ref": word.ref},
        }
        if key not in letter["forms"]:
            line["glyph"] = key
        lines.append(line)
    return lines


def edge_lines(
    font: TTFont,
    font_bytes: bytes,
    definition: dict[str, Any],
    forms: dict[str, Any],
    words: list[Word],
) -> dict[str, Any]:
    """Every letter's edge-case lines, keyed by codepoint, with the
    alternates no short string reaches listed apart.
    """
    from sawa_tools.lab_parts import glyph_class

    names = font.getGlyphOrder()
    shaper = Shaper(
        font_bytes, names, {n for n in names if glyph_class(font, n) == "mark"}
    )
    edges = substitutions(font)
    occurrences = word_occurrences(words, shaper)
    marks = [chr(int(cp[2:], 16)) for cp in definition["everydayCodepoints"]]
    cmap = font.getBestCmap() or {}
    out: dict[str, Any] = {}
    for letter in definition["letters"]:
        defaults = {
            glyph
            for form in letter["forms"]
            for glyph in forms[f"{letter['codepoint']}|{form}"]["glyphs"]
        }
        found = reachable({cmap[ord(letter["char"])]}, edges)
        wanted = {g: alt for g, alt in found.items() if g not in defaults}
        font_found, unreached = font_lines(
            letter, definition["letters"], marks, wanted, shaper
        )
        real = word_lines(letter, occurrences, sorted(wanted))
        by_word = {line["glyph"] for line in real if "glyph" in line}
        out[letter["codepoint"]] = {
            "lines": [
                *font_found,
                *situational_lines(letter, "shadda" not in letter["implausible"]),
                *real,
            ],
            "unreached": [u for u in unreached if u["glyph"] not in by_word],
        }
    return out
