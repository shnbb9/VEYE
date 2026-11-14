"""Food Choices as the approved prototype shows it: four checklists.

The member ticks the foods they commonly eat, may add a food of their own with
a Best / Fair / Limit label, and marks each category's note as read ("I got
it"). Every category, tier, food name and info text below is the approved
prototype's (`build/dashboard.html`, `FOOD_CATEGORIES` and `FC_TIER_INFO` —
the client's Dashboard edits of 20 Aug 2026 and Functional Edits 260825),
extracted from that file rather than retyped. The owner chose this screen over
the HOW TO meal builder on 14 Nov 2026; the builder's lists (`catalog.py`) and
its API stay, unused by the member screen.

This is the only copy. The member screen fetches it, and a saved checklist is
checked against it, so a ticked food is always a name on these lists — two
spellings of one option once scored 0 elsewhere in this product.

A food the member adds is the member's own words under the member's own label.
Veye does not classify it, and nothing here reviews it: the prototype marks it
"Pending Review", and no review queue exists yet (an open client question).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Group:
    tier: str
    label: str
    items: tuple[str, ...]


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    info: str
    tier_info: str
    groups: tuple[Group, ...]

    def names(self) -> tuple[str, ...]:
        return tuple(item for group in self.groups for item in group.items)


# The member's own label for a food they add (Functional Edits 260825: "BEST,
# FAIR or LIMIT"). Required, and recorded as the member chose it.
CUSTOM_TIERS: tuple[str, ...] = ("best", "fair", "limit")
CUSTOM_NAME_MAX = 120
CUSTOM_PER_CATEGORY_MAX = 100

CATEGORIES: tuple[Category, ...] = (
    Category(
        key='proteins',
        label='Proteins',
        info=('Proteins help preserve lean mass, support satiety, and stabilize energy. Favor '
              'minimally processed protein sources and balance portions across your day.'),
        tier_info=('BEST protein choices are low in fat or have healthy fats and are not processed or '
                   'minimally processed. FAIR protein choices have a higher amount of saturated fat '
                   'and/or are minimally processed. LIMIT protein choices have high fat and/or are '
                   'ultra processed.'),
        groups=(
            Group(tier='best', label='Best',
                  items=(
                      'Egg whites',
                      'Egg beaters',
                      'Chicken breast, skinless',
                      'Turkey breast, skinless',
                      'Ground turkey',
                      'Fish',
                      'Tofu (firm/extra firm)',
                      'Cottage cheese',
                      'Soy burgers/dogs/sausage',
                      'Protein powder',
                      'Beef (free range/game)',)),
            Group(tier='fair', label='Fair',
                  items=(
                      'Whole eggs',
                      'Beef (lean cuts/ground)',
                      'Canadian bacon (lean)',
                      'Chicken/turkey dark meat',
                      'Duck',
                      'Ham (lean)',
                      'Lamb (lean)',
                      'Pork (lean)',
                      'Turkey bacon',
                      'Low-fat cheese',
                      'Mozzarella (skim)',
                      'Ricotta (skim)',
                      'Hard or full-fat cheese',)),
            Group(tier='poor', label='Limit',
                  items=(
                      'Pork/beef bacon',
                      'Fatty cuts of beef',
                      'Hot dogs',
                      'Kielbasa',
                      'Liver (beef/chicken)',
                      'Pepperoni',
                      'Salami',
                      'Sausage',)),
        )),
    Category(
        key='fats',
        label='Fats',
        info=('Healthy fats support hormones, brain function, and long-lasting energy. Prioritize '
              'whole-food fats and avoid heavily refined industrial oils when possible.'),
        tier_info=('BEST choices are Omega 9 (neutral) and mostly monounsaturated. FAIR choices are '
                   'Omega 9 (neutral) and saturated. LIMIT them from your diet.'),
        groups=(
            Group(tier='best', label='Best — Monounsaturated (Omega-9)',
                  items=(
                      'Extra virgin olive oil',
                      'Olive oil (extra light, for cooking)',
                      'Avocado',
                      'Guacamole',
                      'Almond butter',
                      'Almonds (slivered/whole)',
                      'Cashews',
                      'Macadamia nuts',
                      'Olives',
                      'Pistachios',
                      'Tahini',)),
            Group(tier='fair', label='Fair — Saturated Omega-9',
                  items=(
                      'Mayonnaise (regular/light)',
                      'Sesame oil',
                      'High oleic safflower oil',
                      'Walnuts',
                      'Bacon bits',
                      'Butter',
                      'Cream (half & half)',
                      'Cream cheese',
                      'Lard',
                      'Sour cream',)),
            Group(tier='poor', label='Limit — Pro-inflammatory Omega-6',
                  items=(
                      'Canola oil',
                      'Peanut oil',
                      'Soybean oil',
                      'Vegetable oils (corn/safflower)',
                      'Peanuts & peanut butter',)),
            Group(tier='avoid', label='Avoid',
                  items=(
                      'Trans fats',
                      'Vegetable shortening',
                      'Hydrogenated oils',
                      'Partially hydrogenated oils',)),
        )),
    Category(
        key='favorable_carbs',
        label='Favorable Carbohydrates',
        info=('Favorable carbohydrates are generally fiber-rich and less disruptive to glucose '
              'control. Choose whole-food carbs with nutrients and slower digestion.'),
        tier_info=('Three stars are super favorable foods and great for gut health. They can be eaten '
                   'in unlimited quantities raw or cooked. Two stars are very favorable and great for '
                   'gut health. You can have 3-5 cups per meal, more than most people eat at a time. '
                   'BEST are great for gut health, and you can eat 1 - 1.5 cups per meal. FAIR are '
                   'mostly fruits, are still good for you, and can be eaten in moderation.'),
        groups=(
            Group(tier='super', label='Super Favorable (unlimited)',
                  items=(
                      'Alfalfa sprouts',
                      'Bean sprouts',
                      'Bamboo shoots',
                      'Bok choy',
                      'Broccoli',
                      'Cabbage',
                      'Cauliflower',
                      'Endive',
                      'Escarole',
                      'Lettuce',
                      'Mushrooms',
                      'Spinach',
                      'Turnip greens',)),
            Group(tier='very', label='Very Favorable (4–6 cups per meal)',
                  items=(
                      'Artichoke',
                      'Artichoke hearts',
                      'Asparagus',
                      'Celery',
                      'Cucumber',
                      'Eggplant',
                      'Green/wax beans',
                      'Kale',
                      'Onions',
                      'Peppers',
                      'Snow peas',
                      'Tomatoes',
                      'Zucchini',)),
            Group(tier='best', label='Favorable Legumes',
                  items=(
                      'Hummus',
                      'Black beans',
                      'Chickpeas',
                      'Kidney beans',
                      'Lentils',
                      'Salsa',)),
            Group(tier='fair', label='Favorable Fruits (portions per meal)',
                  items=(
                      'Apple',
                      'Applesauce',
                      'Apricots',
                      'Blueberries',
                      'Cantaloupe / Honeydew',
                      'Cherries',
                      'Grapes',
                      'Grapefruit',
                      'Kiwi',
                      'Nectarine',
                      'Orange',
                      'Peach',
                      'Pear',
                      'Pineapple',
                      'Plum',
                      'Raspberries',
                      'Strawberries',
                      'Tangerine',)),
        )),
    Category(
        key='unfavorable_carbs',
        label='Unfavorable Carbohydrates',
        info=('Unfavorable carbohydrates are often rapidly absorbed and low in nutrient density. '
              'Keeping these occasional can help improve metabolic consistency.'),
        tier_info=('Unfavorable carbohydrates enter the bloodstream quickly as sugar, cause a rapid '
                   'rise in insulin, and increase inflammation. Eat in moderation.'),
        groups=(
            Group(tier='poor', label='Starchy Vegetables',
                  items=(
                      'Acorn squash',
                      'Baked beans',
                      'Beets',
                      'Butternut squash',
                      'Carrots',
                      'Corn',
                      'French fries',
                      'Lima beans',
                      'Parsnips',
                      'Peas',
                      'Pinto beans',
                      'Potatoes',
                      'Refried beans',
                      'Sweet potatoes',)),
            Group(tier='poor', label='Grains & Breads (incl. "whole grain")',
                  items=(
                      'Bagels',
                      'Biscuits',
                      'Bread',
                      'Buckwheat',
                      'Cereal & granola',
                      'Cornbread',
                      'Couscous',
                      'Crackers',
                      'Croissants / Doughnuts',
                      'Grits',
                      'Muffins',
                      'Pancakes / Waffles',
                      'Pasta',
                      'Popcorn',
                      'Pretzels',
                      'Quinoa',
                      'Rice / Rice cakes',
                      'Tortillas / Tortilla chips',)),
            Group(tier='poor', label='Unfavorable Fruits / Juices',
                  items=(
                      'Bananas',
                      'Cranberries',
                      'Dried fruit (raisins, prunes…)',
                      'Figs',
                      'Guava',
                      'Mango',
                      'Papaya',
                      'Fruit juice',
                      'Vegetable juice',)),
            Group(tier='poor', label='Sugars, Alcohol & Sweeteners',
                  items=(
                      'Sugary drinks',
                      'Candy',
                      'Cake / Cookies / Baked goods',
                      'Honey',
                      'Jam / Jelly',
                      'Ketchup / Cocktail sauce',
                      'Molasses',
                      'Sugar',
                      'Teriyaki sauce',
                      'Wine',
                      'Beer',
                      'Alcohol',)),
        )),
)

ORDER: tuple[str, ...] = tuple(c.key for c in CATEGORIES)
_BY_KEY = {c.key: c for c in CATEGORIES}


def category(key: str) -> Category | None:
    return _BY_KEY.get(key)
