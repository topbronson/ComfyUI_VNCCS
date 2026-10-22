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
    _clean_assist_draft,
    _clean_assist_history,
    _clean_assist_issues,
    _clean_assist_patch,
    _clean_experiment_tags,
    _experiment_tags_mode_enabled,
    _flag_tokens_for,
    _race_flagged_tokens,
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


# --- experiment tags (opt-in unknown-race surface) ----------------------------

def test_race_flagged_surfaces_allowlist_misses_only():
    flagged = _race_flagged_tokens("cetacean person, foxfolk, afro, black_student, cat_girl, jellyfish knight")
    assert flagged == ["cetacean person", "jellyfish knight"], (
        "known presets kept silently, social blocklist keeps silent-drop")
    assert _race_flagged_tokens("human, person") == []
    assert _race_flagged_tokens("afro, black student") == [], "blocklist never becomes an experiment"


def test_race_flagged_strips_weighting_and_bounds():
    flagged = _race_flagged_tokens("crystal:1.3 fox-being, *void dancer*, " + "x" * 200)
    assert flagged[0] == "crystal fox-being" or flagged[0] == "crystal 1.3 fox-being"
    assert "*" not in "".join(flagged), "asterisks never leave the render layer"
    for token in flagged:
        assert ":" not in token and len(token) <= 80
    many = _race_flagged_tokens(", ".join(f"species {i}" for i in range(20)))
    assert len(many) == 8, "capped at EXPERIMENT_TAG_LIMIT"
    assert len(set(many)) == 8, "deduped"


def test_clean_experiment_tags_contract():
    assert _clean_experiment_tags("a, a, b") == ["a", "b"]
    assert _clean_experiment_tags(["  jelly folk ", "bad\x00tag", "afro"]) == ["jelly folk", "badtag"], "control chars strip; blocklist filtered on read"
    assert _clean_experiment_tags(None) == [] and _clean_experiment_tags(5) == []
    assert _clean_experiment_tags({"nope": 1}) == []


def test_experiment_tags_mode_enabled():
    assert _experiment_tags_mode_enabled(None, "qi2") is False
    assert _experiment_tags_mode_enabled({"include_experiment_tags": True}, "qi2") is True
    gs = {"include_experiment_tags": True, "mode_settings": {"qi2": {"include_experiment_tags": False}}}
    assert _experiment_tags_mode_enabled(gs, "qi2") is False, "per-mode override wins"
    assert _experiment_tags_mode_enabled(gs, "Illustrious") is True, "falls back to global"


def test_race_flagged_word_level_blocklist_screen():
    assert _race_flagged_tokens("african spirit, black flame wraith, void dancer") == []  or \
        all("african" not in t and "black" not in t for t in _race_flagged_tokens("african spirit, black flame wraith, void dancer"))
    assert {"field": "race", "token": "void dancer"} in _flag_tokens_for("race", "void dancer")


def test_flag_tokens_for_skin_and_breast():
    assert _flag_tokens_for("skin_color", "iridescent scale skin") == [{"field": "skin_color", "token": "iridescent scale skin"}]
    assert _flag_tokens_for("skin_color", "golden tan skin") == [], "allowlisted value never flagged"
    assert _flag_tokens_for("skin_color", "black skin, blue scales") == [
        {"field": "skin_color", "token": "blue scales"}], "blocked-word token stays silently dropped"
    assert _flag_tokens_for("breast_size", "modest bust, huge breasts") == [
        {"field": "breast_size", "token": "modest bust"}]
    assert _flag_tokens_for("hair", "anything at all") == [], "free-text fields have no allowlist to miss"
    from nodes.character_creator_v2 import _attach_flagged
    out = _attach_flagged({}, {"race": "Luminoth", "skin_color": "starlit skin", "breast_size": "large breasts"}, "test")
    assert out["flagged"] == [{"field": "race", "token": "Luminoth"}, {"field": "skin_color", "token": "starlit skin"}]


def test_prompt_injection_per_mode():
    from nodes.character_creator_v2 import CharacterCreatorV2, _qi2_character_fields
    info = {"sex": "female", "age": 20, "race": "foxfolk", "hair": "silver_hair",
            "eyes": "amber eyes", "face": "", "body": "slim build", "skin_color": "",
            "additional_details": "freckles", "experiment_tags": ["cetacean markings", "void-touched"],
            "image_type": "full_body", "style": "none"}
    pos, _ = CharacterCreatorV2.construct_tag_prompt(info, "illustrious", include_experiment_tags=True)
    assert "(cetacean markings:1.0)" in pos and "(void-touched:1.0)" in pos
    pos_off, _ = CharacterCreatorV2.construct_tag_prompt(info, "illustrious", include_experiment_tags=False)
    assert "cetacean" not in pos_off, "opt-out must be invisible in the prompt"
    fields = _qi2_character_fields(info, include_experiment_tags=True)
    assert "unusual species features: cetacean markings, void-touched" in fields["additional_details"]
    assert "*" not in fields["additional_details"], "no marker leaks to the prompt"
    fields_off = _qi2_character_fields(info)
    assert "cetacean" not in fields_off["additional_details"]


def test_tag_mode_token_budget_cap_and_placement():
    from nodes.character_creator_v2 import CharacterCreatorV2, EXPERIMENT_TAG_PROMPT_LIMIT_TAGGED
    tags = [f"novel token {chr(97 + i)}" for i in range(EXPERIMENT_TAG_PROMPT_LIMIT_TAGGED + 3)]
    info = {"sex": "female", "age": 20, "race": "foxfolk", "hair": "silver_hair",
            "eyes": "", "face": "", "body": "", "skin_color": "",
            "additional_details": "", "experiment_tags": tags,
            "image_type": "full_body", "style": "none"}
    pos, _ = CharacterCreatorV2.construct_tag_prompt(info, "illustrious", include_experiment_tags=True)
    # SDXL-lineage modes inject only the first N tags; the rest never leak.
    for i in range(EXPERIMENT_TAG_PROMPT_LIMIT_TAGGED):
        assert f"({tags[i]}:1.0)" in pos
    for i in range(EXPERIMENT_TAG_PROMPT_LIMIT_TAGGED, len(tags)):
        assert tags[i] not in pos, "over-budget tags must not reach the prompt"
    # Front-loaded: tags sit immediately after the race field, not in the tail.
    race_at = pos.index("(foxfolk")
    first_at = pos.index(f"({tags[0]}:1.0)")
    tail_at = pos.rindex(f"({tags[EXPERIMENT_TAG_PROMPT_LIMIT_TAGGED - 1]}:1.0)")
    assert race_at < first_at < tail_at
    assert tail_at - first_at < 120, "injected tags must be contiguous right after race"
    # Empty race: fallback tail placement still injects them.
    info2 = dict(info, race="")
    pos2, _ = CharacterCreatorV2.construct_tag_prompt(info2, "illustrious", include_experiment_tags=True)
    assert f"({tags[0]}:1.0)" in pos2
    # qi2 prose path keeps the full stored list (no chunk-window constraint).
    from nodes.character_creator_v2 import _qi2_character_fields
    qfields = _qi2_character_fields(info, include_experiment_tags=True)
    assert all(t in qfields["additional_details"] for t in tags)


# --- _clean_assist_history / _clean_assist_draft -----------------------------

def test_assist_prompts_require_rounded_additional_details():
    from nodes.character_creator_v2 import _build_assist_prompts
    post = {"description": "a quiet librarian girl", "history": [], "draft": None, "count": 5}
    _, user_prompt = _build_assist_prompts("draft", post)
    assert "Always fill additional_details" in user_prompt, "draft prompt must push concept-specific round-out details"
    assert "comma-separated" in user_prompt and "NOT full sentences" in user_prompt
    # safety rules must survive the enrichment guidance
    assert "species/fantasy traits only" in user_prompt
    assert "Do not guess a default" in user_prompt or "do not guess a default" in user_prompt
    assert "Do not describe clothing" in user_prompt
    # the shared block reaches the other assist actions too
    draft = {"sex": "female", "age": 20, "race": "human", "skin_color": "", "body": "slim",
             "face": "", "hair": "brown_hair", "eyes": "brown eyes", "additional_details": ""}
    for action in ("reroll_field", "polish_field", "review", "names", "edit_command"):
        _, up = _build_assist_prompts(action, {"draft": draft, "field": "hair",
                                               "instruction": "x", "count": 3})
        assert "Always fill additional_details" in up, f"{action} must share the rules block"

def test_clean_history_bounds_roles_and_drops_junk():
    turns = [{"role": "assistant", "text": "ok"}, "junk", {"role": "USER", "text": "  hi\x07 "},
             {"role": "user", "text": ""}, {"text": "no role -> user"}, {"role": "x", "text": "y"}]
    out = _clean_assist_history(turns)
    assert out == [{"role": "assistant", "text": "ok"}, {"role": "user", "text": "hi"},
                   {"role": "user", "text": "no role -> user"}, {"role": "user", "text": "y"}]
    bounded = _clean_assist_history([{"role": "user", "text": f"t{i}"} for i in range(12)])
    assert len(bounded) == 8 and bounded[0]["text"] == "t4" and bounded[-1]["text"] == "t11"
    assert _clean_assist_history([{"role": "user", "text": "z" * 2000}])[0]["text"] == "z" * 800
    assert _clean_assist_history("not a list") == []


def test_draft_action_accepts_history_and_draft():
    post, err = _validate_assist_request({
        "action": "draft", "description": "anubis scholar",
        "history": [{"role": "user", "text": "earlier idea"}],
        "draft": {"sex": "MALE", "age": "300", "hair": "x\x00y", "extra": "drop me"},
    })
    assert err is None
    assert post["history"] == [{"role": "user", "text": "earlier idea"}]
    assert post["draft"]["sex"] == "male" and post["draft"]["age"] == 100
    assert post["draft"]["hair"] == "xy" and "extra" not in post["draft"]


def test_draft_action_rejects_bad_draft_and_keeps_none():
    assert _validate_assist_request({"action": "draft", "description": "d", "draft": 5})[1] is not None
    post, err = _validate_assist_request({"action": "draft", "description": "d"})
    assert err is None and post["draft"] is None and post["history"] == []


def test_clean_assist_draft_errors():
    assert _clean_assist_draft("nope") == (None, "draft must be an object")
    clean, err = _clean_assist_draft({"sex": "f"})
    assert err is None and clean["sex"] == "female" and clean["age"] == 18


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
