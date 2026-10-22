"""Tests for the Character Wizard assist API helpers (nodes/character_creator_v2.py).

Pins request validation and the per-field sanitizers that guard every LLM
assist output before it can reach the client draft — the same guard family as
the one-shot wizard (postprocess_character_wizard_result).
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

pytest.importorskip("torch")

from nodes.character_creator_v2 import (
    ASSIST_TEXT_FIELDS,
    CHARACTER_PRESETS,
    RACE_OPTION_TAGS,
    SKIN_COLOR_OPTIONS,
    _clean_assist_issues,
    _clean_assist_patch,
    _sanitize_assist_names,
    _sanitize_assist_value,
    _validate_assist_request,
)


def _base_draft():
    draft = {"sex": "female", "age": 20}
    for key in ASSIST_TEXT_FIELDS:
        draft[key] = ""
    return draft


# --- _validate_assist_request -------------------------------------------------

def test_validate_rejects_unknown_action():
    post, err = _validate_assist_request({"action": "mind_control"})
    assert post is None and "mind_control" in err


def test_validate_draft_requires_description_and_bounds_length():
    assert _validate_assist_request({"action": "draft"})[1] is not None
    assert _validate_assist_request({"action": "draft", "description": "   "})[1] is not None
    assert _validate_assist_request({"action": "draft", "description": "x" * 2001})[1] is not None
    post, err = _validate_assist_request({"action": "draft", "description": "  a shy swamp witch \n"})
    assert err is None and post["description"] == "a shy swamp witch"


def test_validate_draft_action_requires_draft_object():
    assert _validate_assist_request({"action": "reroll_field", "field": "hair"})[1] is not None
    assert _validate_assist_request({"action": "reroll_field", "draft": "nope", "field": "hair"})[1] is not None


def test_validate_reroll_requires_known_field():
    post, err = _validate_assist_request(
        {"action": "reroll_field", "draft": _base_draft(), "field": "negative_prompt"})
    assert post is None and "negative_prompt" in err


def test_validate_normalizes_draft_and_does_not_mutate_input():
    original = {"sex": "MALE", "age": "500", "hair": "silver_hair\x00", "evil_key": "x" * 900}
    post, err = _validate_assist_request(
        {"action": "polish_field", "draft": original, "field": "hair", "count": 99})
    assert err is None
    clean = post["draft"]
    assert clean["sex"] == "male"
    assert clean["age"] == 100
    assert clean["hair"] == "silver_hair"
    assert "evil_key" not in clean
    assert post["count"] == 10
    # non-draft actions must copy, not mutate the caller's payload
    assert original["sex"] == "MALE" and "evil_key" in original


def test_validate_clamps_age_and_count_types():
    post, err = _validate_assist_request(
        {"action": "names", "draft": {"age": "abc"}, "count": "junk"})
    assert err is None
    assert post["draft"]["age"] == 18 and post["count"] == 5


def test_validate_edit_command_requires_instruction():
    assert _validate_assist_request(
        {"action": "edit_command", "draft": _base_draft()})[1] is not None
    assert _validate_assist_request(
        {"action": "edit_command", "draft": _base_draft(), "instruction": "y" * 2001})[1] is not None


def test_validate_caps_each_draft_field():
    # Per-field 400-char truncation runs before the size gate, which keeps the
    # whole-draft JSON bound (ASSIST_MAX_DRAFT_JSON) as a defensive backstop.
    draft = _base_draft()
    draft["additional_details"] = "z" * 900
    post, err = _validate_assist_request({"action": "names", "draft": draft})
    assert err is None
    assert len(post["draft"]["additional_details"]) == 400


# --- _sanitize_assist_value ---------------------------------------------------

def test_sanitize_race_drops_ethnicity_tokens_and_honours_human_hint():
    assert _sanitize_assist_value("race", "afro student", {}, "a normal human college girl") == "human"


def test_sanitize_race_keeps_curated_race_tokens():
    valid = sorted(RACE_OPTION_TAGS)[0]
    assert _sanitize_assist_value("race", valid, {}, "") == valid


def test_sanitize_skin_color_whitelist():
    assert _sanitize_assist_value("skin_color", "glowing neon skin", {}, "") == ""
    valid = SKIN_COLOR_OPTIONS[0]
    assert _sanitize_assist_value("skin_color", valid, {}, "").lower() == valid.lower()


def test_sanitize_breast_size_filters_foreign_tags():
    out = _sanitize_assist_value("breast_size", "huge breasts, purple hair, teacher", {}, "")
    assert out == "huge breasts"


def test_sanitize_generic_field_caps_tokens_and_length():
    value = ", ".join(f"token{i}" for i in range(30))
    out = _sanitize_assist_value("additional_details", value, {}, "")
    assert len(out.split(", ")) <= 8 and len(out) <= 300


def test_sanitize_drops_control_chars_and_joins_lists():
    out = _sanitize_assist_value("hair", ["silver_hair\x07", "long_hair"], {}, "")
    assert out == "silver_hair, long_hair"


# --- _sanitize_assist_names ---------------------------------------------------

def test_sanitize_names_filters_dedupe_and_clamps():
    # non-strings are stringified first, so "42" survives the charset check
    names = ["Aria", "aria", "Bad;name<", "1Mi-ra e", 42, "", "X" * 60]
    out = _sanitize_assist_names(names, 10)
    assert out == ["Aria", "1Mi-ra e", "42"]
    assert _sanitize_assist_names(["A", "B", "C", "D"], 2) == ["A", "B"]
    assert _sanitize_assist_names("not a list", 5) == []
    assert _sanitize_assist_names(["A", "B"], 0) == ["A"]


# --- _clean_assist_patch (edit_command) ---------------------------------------

def test_clean_patch_normalises_sex_and_age():
    patch = _clean_assist_patch({"sex": "MALE-ish", "age": "25.7", "age_junk": 40}, _base_draft(), "")
    assert patch == {"sex": "male", "age": 25}
    assert _clean_assist_patch({"age": "forty"}, _base_draft(), "") == {}
    assert _clean_assist_patch("not a dict", _base_draft(), "") == {}


def test_clean_patch_drops_unknown_keys_and_filtered_to_empty():
    patch = _clean_assist_patch(
        {"negative_prompt": "nudity", "skin_color": "impossible tone", "hair": "silver_hair"},
        _base_draft(), "")
    assert "negative_prompt" not in patch
    assert "skin_color" not in patch  # filtered-to-empty on non-empty input
    assert patch.get("hair") == "silver_hair"


def test_clean_patch_allows_explicit_clear():
    patch = _clean_assist_patch({"eyes": "   "}, _base_draft(), "")
    assert patch == {"eyes": ""}


# --- _clean_assist_issues (review) ---------------------------------------------

def test_clean_issues_advisory_only_with_sanitized_suggestions():
    draft = _base_draft()
    issues = _clean_assist_issues(
        [
            {"field": "hair", "note": "contradicts eyes", "suggestion": "silver_hair"},
            {"field": "evil_field", "note": "untrusted", "suggestion": "hack me"},
            {"field": "skin_color", "note": "bad suggestion", "suggestion": "neon glow"},
            "not-a-dict",
            {"note": ""},
        ],
        draft, "")
    assert issues[0] == {"note": "contradicts eyes", "field": "hair", "suggestion": "silver_hair"}
    # invalid field: note kept, suggestion never surfaces
    assert issues[1] == {"note": "untrusted"}
    # valid field, unsafe suggestion: note kept, suggestion dropped
    assert issues[2] == {"note": "bad suggestion", "field": "skin_color"}
    assert len(issues) == 3


def test_clean_issues_empty_and_caps():
    assert _clean_assist_issues(None, _base_draft(), "") == []
    many = [{"note": f"n{i}"} for i in range(12)]
    assert len(_clean_assist_issues(many, _base_draft(), "")) == 8
