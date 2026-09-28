import pytest

from sawa_tools.cli import GROUPS, main


def test_help_lists_every_group(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--help"])
    assert exit_info.value.code == 0
    out = capsys.readouterr().out
    for group in GROUPS:
        assert group in out


def test_group_without_command_is_a_usage_error() -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["build"])
    assert exit_info.value.code == 2
