from airgrove.aqi import category, load


def test_breakpoints():
    assert category(0)["name"] == "Good"
    assert category(30)["name"] == "Good"
    assert category(30.6)["name"] == "Satisfactory"
    assert category(60)["name"] == "Satisfactory"
    assert category(90)["name"] == "Moderate"
    assert category(120)["name"] == "Poor"
    assert category(250)["name"] == "Very Poor"
    assert category(251)["name"] == "Severe"
    assert category(900)["name"] == "Severe"


def test_categories_contiguous():
    cats = load()["categories"]
    for a, b in zip(cats, cats[1:], strict=False):
        assert b["min"] == a["max"] + 1
