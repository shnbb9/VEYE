"""Sample days — verbatim from the approved prototype's SAMPLE_DAYS
(build/dashboard.html, Meal Planning), which reproduce the client's five day
documents (25 Aug 2026; FEEDBACK_DOCS_2/WEEKDAY_SAMPLES). Times are the
documents' own; the member changes times and foods after copying."""

from __future__ import annotations

COPY_NOTE = "Veye sample day — change the times and the foods as desired."


def _m(name: str, kind: str, time: str, notes: str = "") -> dict[str, str]:
    return {"name": name, "type": kind, "time": time, "notes": notes}


SAMPLE_DAYS: tuple[dict, ...] = (
    {"key": "wd", "label": "Work day", "options": [{"label": None, "meals": [
        _m("Wake up", "Routine", "06:30"),
        _m("Snack", "Snack", "07:00", "hard boiled egg, clementine, 3 almonds"),
        _m("Breakfast", "Breakfast", "08:30", "chicken sausages, an apple, ½ cup grapes"),
        _m("Lunch", "Lunch", "13:00", "large salad with protein, ¼ cup lentils, 16 cherries"),
        _m("Dinner", "Dinner", "18:00", "salmon, brussel sprouts, whipped cauliflower, 1 cup pineapple"),
        _m("Bed", "Routine", "22:00")]}]},
    {"key": "wdxm", "label": "Work day with morning exercise", "options": [{"label": None, "meals": [
        _m("Wake up", "Routine", "06:00"),
        _m("Snack", "Snack", "06:30", "protein shake"),
        _m("Exercise", "Exercise", "07:00"),
        _m("Breakfast", "Breakfast", "08:30", "omelette, orange, ½ cup blueberries"),
        _m("Lunch", "Lunch", "13:00", "turkey and hummus, clementine"),
        _m("Dinner", "Dinner", "18:00", "filet of sole, escarole, fruit salad"),
        _m("Bed", "Routine", "22:00")]}]},
    {"key": "wdxa", "label": "Work day, exercise after work", "options": [{"label": None, "meals": [
        _m("Wake up", "Routine", "06:30"),
        _m("Breakfast", "Breakfast", "07:00", "omelette, cup of grapes, clementine"),
        _m("Lunch", "Lunch", "12:00", "large salad with protein, ½ cup chickpeas, pear"),
        _m("Snack", "Snack", "17:00", "cheese stick, kiwi"),
        _m("Exercise", "Exercise", "18:00"),
        _m("Dinner", "Dinner", "19:00", "chicken, green beans, ½ cantaloup"),
        _m("Bed", "Routine", "23:00")]}]},
    {"key": "wkd", "label": "Weekend day", "options": [{"label": None, "meals": [
        _m("Wake up", "Routine", "07:00"),
        _m("Snack", "Snack", "07:30", "hard boiled egg, clementine, 3 almonds"),
        _m("Breakfast", "Breakfast", "09:00", "sausages, ¾ cup of slow cooked oatmeal"),
        _m("Brunch", "Brunch", "14:00", "omelette, side salad, 2 cups fruit salad"),
        _m("Dinner", "Dinner", "19:00", "free range beef, asparagus, black beans"),
        _m("Bed", "Routine", "23:00")]}]},
    {"key": "wkdx", "label": "Weekend day with morning exercise", "options": [
        {"label": "Option 1", "meals": [
            _m("Wake up", "Routine", "07:00"),
            _m("Snack", "Snack", "07:30", "hard boiled egg, clementine, 3 almonds"),
            _m("Exercise", "Exercise", "08:00"),
            _m("Breakfast", "Breakfast", "09:30", "scrambled egg whites (olive oil), ¾ melon"),
            _m("Brunch", "Brunch", "14:30", "frisee salad with lardon and eggs, 1 cup pineapple"),
            _m("Dinner", "Dinner", "19:30", "turkey chili with black beans"),
            _m("Bed", "Routine", "23:00")]},
        # Option 2 (document pages 2-3): the shared 7:00 wake / 7:30 snack /
        # 8:00 exercise structure, then the pages' own meals and times.
        {"label": "Option 2", "meals": [
            _m("Wake up", "Routine", "07:00"),
            _m("Snack", "Snack", "07:30", "hard boiled egg, clementine, 3 almonds"),
            _m("Exercise", "Exercise", "08:00"),
            _m("Breakfast", "Breakfast", "09:00", "chicken sausages, an apple, ½ cup grapes"),
            _m("Brunch", "Brunch", "14:00", "large salad with protein, ¼ cup lentils, 16 cherries"),
            _m("Dinner", "Dinner", "19:00", "salmon, brussel sprouts, whipped cauliflower, 1 cup pineapple"),
            _m("Bed", "Routine", "23:00")]}]},
)


def sample_name(key: str, option: int) -> tuple[str, list[dict[str, str]]]:
    """The name a copy is given (`label — Option n`) and its meals."""
    day = next((d for d in SAMPLE_DAYS if d["key"] == key), None)
    if day is None or not 0 <= option < len(day["options"]):
        raise KeyError(key)
    chosen = day["options"][option]
    return day["label"] + (f" — {chosen['label']}" if chosen["label"] else ""), [dict(m) for m in chosen["meals"]]
