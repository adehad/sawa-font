import json
from pathlib import Path

from sawa_tools.checks.i18n import check_dir
from sawa_tools.cli import main

REAL_I18N_DIR = Path(__file__).parents[2] / "site" / "src" / "i18n"


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def test_passing_case(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello"})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    assert check_dir(tmp_path).errors == []


def test_missing_key_in_ar(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello", "farewell": "Bye"})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    errors = check_dir(tmp_path).errors

    assert any("ar.json" in error and "farewell" in error for error in errors)


def test_missing_key_in_en(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello"})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا", "farewell": "مع السلامة"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error and "farewell" in error for error in errors)


def test_nested_value_rejected(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": {"nested": "Hello"}})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error and "greeting" in error for error in errors)


def test_ar_plural_missing_a_category(tmp_path: Path) -> None:
    write_json(
        tmp_path / "en.json",
        {"count": "{n, plural, =0 {No items} one {# item} other {# items}}"},
    )
    write_json(
        tmp_path / "ar.json",
        {"count": "{n, plural, zero {} one {} two {} many {} other {}}"},
    )

    errors = check_dir(tmp_path).errors

    assert any("few" in error and "count" in error for error in errors)


def test_ar_plural_with_all_categories_passes(tmp_path: Path) -> None:
    write_json(
        tmp_path / "en.json",
        {"count": "{n, plural, =0 {No items} one {# item} other {# items}}"},
    )
    write_json(
        tmp_path / "ar.json",
        {"count": "{n, plural, zero {} one {} two {} few {} many {} other {}}"},
    )

    assert check_dir(tmp_path).errors == []


def test_plural_detected_without_spaces(tmp_path: Path) -> None:
    write_json(
        tmp_path / "en.json",
        {"count": "{n,plural,=0{No items}one{# item}other{# items}}"},
    )
    write_json(
        tmp_path / "ar.json",
        {"count": "{n,plural,zero{}one{}two{}many{}other{}}"},
    )

    errors = check_dir(tmp_path).errors

    assert any("few" in error and "count" in error for error in errors)


def test_selectordinal_requires_only_other(tmp_path: Path) -> None:
    write_json(
        tmp_path / "en.json",
        {"place": "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"},
    )
    write_json(tmp_path / "ar.json", {"place": "{n, selectordinal, other {}}"})

    assert check_dir(tmp_path).errors == []


def test_selectordinal_missing_other_fails(tmp_path: Path) -> None:
    write_json(
        tmp_path / "en.json",
        {"place": "{n, selectordinal, one {#st} other {#th}}"},
    )
    write_json(tmp_path / "ar.json", {"place": "{n, selectordinal, one {}}"})

    errors = check_dir(tmp_path).errors

    assert any("other" in error and "place" in error for error in errors)


def test_invalid_json_reported(tmp_path: Path) -> None:
    (tmp_path / "en.json").write_text("{not valid json", encoding="utf-8")
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error and "invalid JSON" in error for error in errors)


def test_invalid_encoding_reported(tmp_path: Path) -> None:
    (tmp_path / "en.json").write_bytes(b"\xff\xfe\x00\x01")
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error and "invalid JSON" in error for error in errors)


def test_empty_dir_fails(tmp_path: Path) -> None:
    errors = check_dir(tmp_path).errors

    assert any("en.json" in error for error in errors)


def test_missing_en_json_fails(tmp_path: Path) -> None:
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error for error in errors)


def test_single_locale_file_fails(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello"})

    errors = check_dir(tmp_path).errors

    assert any("en.json" in error for error in errors)


def test_real_site_i18n_passes() -> None:
    assert check_dir(REAL_I18N_DIR).errors == []


def test_cli_exits_1_on_missing_key(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello", "farewell": "Bye"})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    assert main(["check", "i18n", "--dir", str(tmp_path)]) == 1


def test_cli_exits_0_on_good_catalog(tmp_path: Path) -> None:
    write_json(tmp_path / "en.json", {"greeting": "Hello"})
    write_json(tmp_path / "ar.json", {"greeting": "مرحبا"})

    assert main(["check", "i18n", "--dir", str(tmp_path)]) == 0
