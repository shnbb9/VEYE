"""The client's food lists, transcribed.

Source of truth, read not recalled:

| What | File |
|---|---|
| Tiers, portions, exclusions, the HOW TO rules | `AI Chatbot Training.docx` (250804) |
| Member-facing checklist wording + the write-in row | `Protein Food Choices.xlsx`, `Favorable Carbohydrate Food Choices template.xlsx`, `Unfavorable Carbohydrate Food Choices template.xlsx`, `Fat Food Choices.xlsx` |

both under `veye copy/veye copy/VeyeDocuments/` (read-only reference).

`ref` on every row is the paragraph number in the training document, so a
disputed figure can be checked against the source in one step rather than
being argued from memory. The extraction is reproducible: the document is a
zip of XML, and the paragraph index is the order of `w:p` elements.

**Portions are the source's own strings, not parsed numbers.** The document
expresses them in whatever unit suits the food — `4oz`, `30 grams`, `9 nuts`,
`1/4 avocado`, `1.5`, `2 cups`, `1 whole small`. Normalising those into a
single numeric would mean choosing densities and conversions the client never
supplied, which is exactly the kind of invention this package exists to avoid.
A portion the source does not state is `None`, and reads back as not
available.

**A snack is half a meal portion** — the document says so twice (p0463,
p0495). It is rendered as "half of <meal portion>" rather than halved
arithmetically: halving `9 nuts` or `1/4 avocado` would produce figures the
source never wrote.

One inconsistency inside the source is recorded and deliberately not
reconciled here; see `PROTEIN_PORTION_NOTE`.
"""

from __future__ import annotations

from dataclasses import dataclass

SOURCE_DOCUMENT = "AI Chatbot Training.docx (250804)"

# ---- groups ----------------------------------------------------------------
PROTEIN = "protein"
CARBOHYDRATE = "carbohydrate"
FAT = "fat"
GROUPS = (PROTEIN, CARBOHYDRATE, FAT)

# The source states every portion as "<amount> woman, <amount> man", so those
# are the keys. They live here and nowhere else: the prototype's scoring once
# returned 0 because two screens spelled an option differently, and a third
# spelling of this one ("female"/"male") was in this package until the lists
# were checked against `body_composition`, which already says Woman and Man.
WOMAN = "woman"
MAN = "man"
SEXES = (WOMAN, MAN)

# ---- tiers, in the source's own order and wording --------------------------
# Protein (p0495, p0509, p0526)
PROTEIN_BEST = "best"
PROTEIN_FAIR = "fair"
PROTEIN_POOR = "poor"

# Carbohydrate (p0411, p0428, p0453, p0407, p0463, p0338)
CARB_SUPER_FAVORABLE = "super_favorable"
CARB_VERY_FAVORABLE = "very_favorable"
CARB_FAVORABLE = "favorable"
CARB_FAVORABLE_GRAIN = "favorable_grain"
CARB_FAVORABLE_FRUIT = "favorable_fruit"
CARB_UNFAVORABLE_VEGETABLE = "unfavorable_vegetable"
CARB_UNFAVORABLE_GRAIN = "unfavorable_grain"
CARB_UNFAVORABLE_SWEET = "unfavorable_sweet"
CARB_UNFAVORABLE_FRUIT = "unfavorable_fruit"
CARB_UNFAVORABLE_OTHER = "unfavorable_other"

FAVORABLE_CARB_TIERS = (
    CARB_SUPER_FAVORABLE,
    CARB_VERY_FAVORABLE,
    CARB_FAVORABLE,
    CARB_FAVORABLE_GRAIN,
    CARB_FAVORABLE_FRUIT,
)
UNFAVORABLE_CARB_TIERS = (
    CARB_UNFAVORABLE_VEGETABLE,
    CARB_UNFAVORABLE_GRAIN,
    CARB_UNFAVORABLE_SWEET,
    CARB_UNFAVORABLE_FRUIT,
    CARB_UNFAVORABLE_OTHER,
)

# Fat (p0542, p0554, p0566, p0571)
FAT_BEST = "best"
FAT_SECOND_BEST = "second_best"
FAT_POOR = "poor"
FAT_AVOID = "avoid"

# The member-facing section headings, exactly as the checklists write them.
TIER_LABELS = {
    PROTEIN: {
        PROTEIN_BEST: "Best choices",
        PROTEIN_FAIR: "Fair choices",
        PROTEIN_POOR: "Poor choices",
    },
    CARBOHYDRATE: {
        CARB_SUPER_FAVORABLE: "Super Favorable",
        CARB_VERY_FAVORABLE: "Very Favorable",
        CARB_FAVORABLE: "Favorable",
        CARB_FAVORABLE_GRAIN: "Favorable grains",
        CARB_FAVORABLE_FRUIT: "Favorable Fruits",
        CARB_UNFAVORABLE_VEGETABLE: "Unfavorable Vegetables",
        CARB_UNFAVORABLE_GRAIN: "Unfavorable Complex Carbohydrates",
        CARB_UNFAVORABLE_SWEET: "Sweets",
        CARB_UNFAVORABLE_FRUIT: "Unfavorable Fruits",
        CARB_UNFAVORABLE_OTHER: "Unfavorable Carbohydrates",
    },
    FAT: {
        FAT_BEST: "Best Choices  Omega 9 and mostly monounsaturated",
        FAT_SECOND_BEST: "Fair Choices  Omega 9 and saturated",
        FAT_POOR: "Poor Choices  Omega 6 (inflammatory)",
        FAT_AVOID: "AVOID or Limit",
    },
}

# How much of a tier is allowed, where the source states it as a tier rule
# rather than per food.
TIER_ALLOWANCE = {
    CARB_SUPER_FAVORABLE: ("unlimited raw or cooked", "unlimited raw or cooked", "p0411"),
    CARB_VERY_FAVORABLE: ("4 cups per meal", "6 cups per meal", "p0428"),
    CARB_FAVORABLE: ("1 cup per meal", "1.5 cups per meal", "p0453"),
}


@dataclass(frozen=True)
class FoodItem:
    """One row of a client list.

    `name` is the checklist's spelling, including its typographic quirks. Two
    screens spelling an option differently is how the prototype's scoring once
    silently returned 0, so the spelling is the key and lives in one place.
    """

    name: str
    group: str
    tier: str
    # The meal portion as the source writes it; None where it writes none.
    portion_woman: str | None = None
    portion_man: str | None = None
    ref: str = ""
    # Set where a rule keys off this row rather than off its tier.
    is_cheese: bool = False

    @property
    def favorable(self) -> bool | None:
        """Favourable/unfavourable is a carbohydrate distinction (p0330)."""
        if self.group != CARBOHYDRATE:
            return None
        return self.tier in FAVORABLE_CARB_TIERS

    def portion(self, sex: str) -> str | None:
        return self.portion_woman if sex == WOMAN else self.portion_man


def _p(name, tier, woman=None, man=None, ref="", is_cheese=False):
    return FoodItem(name, PROTEIN, tier, woman, man, ref, is_cheese)


def _c(name, tier, woman=None, man=None, ref=""):
    return FoodItem(name, CARBOHYDRATE, tier, woman, man, ref)


def _f(name, tier, amount=None, ref=""):
    # Fat amounts in the source are single figures, not split by sex (p0541).
    return FoodItem(name, FAT, tier, amount, amount, ref)


# ---- Proteins (p0488-p0536) -------------------------------------------------
# "For the protein to make a difference, the food needs to be primarily a
# protein like soy or soy products, meat, cheese, poultry, fish, protein
# powders" (p0493).
PROTEINS: tuple[FoodItem, ...] = (
    # Best (p0495-p0507)
    _p("Egg whites", PROTEIN_BEST, "6", "8", "p0497"),
    _p("Egg beaters", PROTEIN_BEST, "1/4 cup", "1/2 cup", "p0498"),
    _p("Beef (free range/game)", PROTEIN_BEST, "4oz", "6 oz", "p0499"),
    _p("Chicken breast, skinless or deli-style", PROTEIN_BEST, "4oz", "6 oz", "p0500"),
    _p("Turkey breast, skinless or deli-style", PROTEIN_BEST, "4oz", "6 oz", "p0501"),
    # The source reads "5oz woman, 7 ox man"; "ox" is a typo for oz, and the
    # unit is not in doubt because every neighbouring row uses oz.
    _p("Ground turkey", PROTEIN_BEST, "5oz", "7 oz", "p0502"),
    _p("Cottage cheese", PROTEIN_BEST, "2/3 cup", "1 cup", "p0503", is_cheese=True),
    _p("Protein Powder", PROTEIN_BEST, "30 grams", "40 grams", "p0504"),
    _p("Soy burgers, soy dogs, soy sausage", PROTEIN_BEST, "30 grams", "40 grams", "p0505"),
    _p("Tofu- firm and extra firm", PROTEIN_BEST, "5oz", "7oz", "p0506"),
    _p("Fish", PROTEIN_BEST, "5oz", "7oz", "p0507"),
    # Fair (p0509-p0524)
    _p("Whole eggs", PROTEIN_FAIR, "3", "4", "p0510"),
    _p("Beef (not free range) - choose lean cuts or lean ground", PROTEIN_FAIR, "4oz", "6 oz", "p0511"),
    _p("Canadian bacon (lean)", PROTEIN_FAIR, "4oz", "6 oz", "p0512"),
    _p("Chicken- skinless dark meat", PROTEIN_FAIR, "4oz", "6 oz", "p0513"),
    _p("Duck", PROTEIN_FAIR, "4oz", "6 oz", "p0514"),
    _p("Corned beef (lean)", PROTEIN_FAIR, "4oz", "6 oz", "p0515"),
    _p("Ham, lean or deli-style", PROTEIN_FAIR, "4oz", "6 oz", "p0516"),
    _p("Lamb (lean)", PROTEIN_FAIR, "4oz", "6 oz", "p0517"),
    _p("Pork (lean)", PROTEIN_FAIR, "4oz", "6 oz", "p0518"),
    _p("Turkey- skinless dark meat", PROTEIN_FAIR, "4oz", "6 oz", "p0519"),
    _p("Turkey bacon", PROTEIN_FAIR, "4oz", "6 oz", "p0520"),
    _p("Cheese - low fat", PROTEIN_FAIR, "4oz", "6 oz", "p0521", is_cheese=True),
    _p("Mozzarella cheese (skim)", PROTEIN_FAIR, "4oz", "6 oz", "p0522", is_cheese=True),
    _p("Ricotta cheese (skim)", PROTEIN_FAIR, "4oz", "6 oz", "p0523", is_cheese=True),
    _p("Hard cheese or full fat cheese", PROTEIN_FAIR, "4oz", "6 oz", "p0524", is_cheese=True),
    # Poor (p0526-p0534)
    _p("Pork or beef bacon", PROTEIN_POOR, "4oz", "6 oz", "p0527"),
    _p("Beef- fatty cuts or high fit ground (> 10-15% fat)", PROTEIN_POOR, "4oz", "6 oz", "p0528"),
    _p("Hot dogs (pork, beef, turkey or chicken)", PROTEIN_POOR, "3", "4", "p0529"),
    _p("Kielbasa", PROTEIN_POOR, "4oz", "6 oz", "p0530"),
    _p("Liver- beef or chicken", PROTEIN_POOR, "4oz", "6 oz", "p0531"),
    _p("Pepperoni", PROTEIN_POOR, "4oz", "6 oz", "p0532"),
    _p("Salami", PROTEIN_POOR, "4oz", "6 oz", "p0533"),
    _p("Sausage", PROTEIN_POOR, "4oz", "6 oz", "p0534"),
)

# ---- Carbohydrates (p0329-p0486) -------------------------------------------
CARBOHYDRATES: tuple[FoodItem, ...] = (
    # Super Favorable - "unlimited amounts raw or cooked" (p0411-p0426)
    _c("Alfalfa sprouts", CARB_SUPER_FAVORABLE, ref="p0414"),
    _c("Bean sprouts", CARB_SUPER_FAVORABLE, ref="p0415"),
    _c("Bamboo shoots", CARB_SUPER_FAVORABLE, ref="p0416"),
    _c("Bok Choy", CARB_SUPER_FAVORABLE, ref="p0417"),
    _c("Broccoli", CARB_SUPER_FAVORABLE, ref="p0418"),
    _c("Cabbage", CARB_SUPER_FAVORABLE, ref="p0419"),
    _c("Cauliflower", CARB_SUPER_FAVORABLE, ref="p0420"),
    _c("Endive", CARB_SUPER_FAVORABLE, ref="p0421"),
    _c("Escarole", CARB_SUPER_FAVORABLE, ref="p0422"),
    _c("Lettuce (iceberg, romaine, etc)", CARB_SUPER_FAVORABLE, ref="p0423"),
    _c("Mushrooms", CARB_SUPER_FAVORABLE, ref="p0424"),
    _c("Spinach", CARB_SUPER_FAVORABLE, ref="p0425"),
    _c("Turnip greens", CARB_SUPER_FAVORABLE, ref="p0426"),
    # Very Favorable - 4 cups woman / 6 cups man per meal (p0428-p0451)
    _c("Artichoke", CARB_VERY_FAVORABLE, ref="p0430"),
    _c("Artichoke hearts", CARB_VERY_FAVORABLE, ref="p0431"),
    _c("Asparagus", CARB_VERY_FAVORABLE, ref="p0432"),
    _c("Green or waxed beans", CARB_VERY_FAVORABLE, ref="p0433"),
    _c("Leeks", CARB_VERY_FAVORABLE, ref="p0434"),
    _c("Okra", CARB_VERY_FAVORABLE, ref="p0435"),
    _c("Sauerkraut", CARB_VERY_FAVORABLE, ref="p0436"),
    _c("Snow peas", CARB_VERY_FAVORABLE, ref="p0437"),
    _c("Celery", CARB_VERY_FAVORABLE, ref="p0439"),
    _c("Cucumber", CARB_VERY_FAVORABLE, ref="p0440"),
    _c("Collard greens", CARB_VERY_FAVORABLE, ref="p0441"),
    _c("Peppers (green, red, orange, yellow)", CARB_VERY_FAVORABLE, ref="p0442"),
    _c("Onions", CARB_VERY_FAVORABLE, ref="p0443"),
    _c("Radishes", CARB_VERY_FAVORABLE, ref="p0444"),
    _c("Tomatoes (ok, this one is really a fruit)", CARB_VERY_FAVORABLE, ref="p0445"),
    _c("Eggplant", CARB_VERY_FAVORABLE, ref="p0446"),
    _c("Kale", CARB_VERY_FAVORABLE, ref="p0447"),
    _c("Swiss chard", CARB_VERY_FAVORABLE, ref="p0448"),
    _c("Turnips", CARB_VERY_FAVORABLE, ref="p0449"),
    _c("Yellow (summer) squash", CARB_VERY_FAVORABLE, ref="p0450"),
    _c("Zucchini", CARB_VERY_FAVORABLE, ref="p0451"),
    # Favorable - 1 cup woman / 1.5 cups man per meal (p0453-p0461).
    # These are the legumes the HOW TO reaches for when a meal is all super
    # or very favourable (p0273) - and the same rule insists they are not
    # proteins (p0255).
    _c("Hummus", CARB_FAVORABLE, ref="p0456"),
    _c("Salsa", CARB_FAVORABLE, ref="p0457"),
    _c("Black beans", CARB_FAVORABLE, ref="p0458"),
    _c("Chickpeas", CARB_FAVORABLE, ref="p0459"),
    _c("Kidney beans", CARB_FAVORABLE, ref="p0460"),
    _c("Lentils", CARB_FAVORABLE, ref="p0461"),
    # Favorable grains - the only two (p0407). The source states one amount
    # per meal for each, with no split by sex.
    _c("Barley", CARB_FAVORABLE_GRAIN, "1/2 cup per meal", "1/2 cup per meal", "p0407"),
    _c("Slow cooked oatmeal", CARB_FAVORABLE_GRAIN, "1 cup per meal", "1 cup per meal", "p0407"),
    # Favorable Fruits (p0463-p0486)
    _c("Apple", CARB_FAVORABLE_FRUIT, "1.5", "2", "p0465"),
    _c("Applesauce", CARB_FAVORABLE_FRUIT, "1 cup", "1.5 cups", "p0466"),
    _c("Blueberries", CARB_FAVORABLE_FRUIT, "2 cups", "3 cups", "p0467"),
    _c("Cantaloupe/Honeydew", CARB_FAVORABLE_FRUIT, "1 whole small", "1 whole medium", "p0468"),
    _c("Cherries", CARB_FAVORABLE_FRUIT, "24", "32", "p0469"),
    _c("Fruit cocktail", CARB_FAVORABLE_FRUIT, "1 cup", "1.5 cups", "p0470"),
    _c("Grapes", CARB_FAVORABLE_FRUIT, "2 cups", "3 cups", "p0471"),
    _c("Grapefruit", CARB_FAVORABLE_FRUIT, "1.5", "2", "p0472"),
    _c("Nectarine", CARB_FAVORABLE_FRUIT, "3", "4", "p0473"),
    _c("Orange", CARB_FAVORABLE_FRUIT, "1.5", "2", "p0474"),
    _c("Pear", CARB_FAVORABLE_FRUIT, "1.5", "2", "p0475"),
    _c("Pineapple", CARB_FAVORABLE_FRUIT, "1.5 cups", "2 cups", "p0476"),
    _c("Apricots", CARB_FAVORABLE_FRUIT, "4", "6", "p0479"),
    _c("Kiwi", CARB_FAVORABLE_FRUIT, "4", "6", "p0480"),
    _c("Mandarin or Clementine orange", CARB_FAVORABLE_FRUIT, "3", "5", "p0481"),
    _c("Peach", CARB_FAVORABLE_FRUIT, "1.5", "2", "p0482"),
    _c("Plum", CARB_FAVORABLE_FRUIT, "3", "5", "p0483"),
    # The source gives one figure for raspberries and no split by sex.
    _c("Raspberries", CARB_FAVORABLE_FRUIT, "4 cups per meal", "4 cups per meal", "p0484"),
    _c("Strawberries", CARB_FAVORABLE_FRUIT, "3 cups", "4 cups", "p0485"),
    _c("Tangerine", CARB_FAVORABLE_FRUIT, "3", "5", "p0486"),
    # On the member checklist but with no amount anywhere in the source.
    # Portion reads back as not available rather than being interpolated.
    _c("Lemon", CARB_FAVORABLE_FRUIT, ref="Favorable Carbohydrate xlsx"),
    _c("Lime", CARB_FAVORABLE_FRUIT, ref="Favorable Carbohydrate xlsx"),
    # Unfavorable Vegetables (p0340-p0356)
    _c("Acorn squash", CARB_UNFAVORABLE_VEGETABLE, ref="p0342"),
    _c("Baked beans", CARB_UNFAVORABLE_VEGETABLE, ref="p0343"),
    _c("Beets", CARB_UNFAVORABLE_VEGETABLE, ref="p0344"),
    _c("Butternut squash", CARB_UNFAVORABLE_VEGETABLE, ref="p0345"),
    _c("Carrots", CARB_UNFAVORABLE_VEGETABLE, ref="p0346"),
    _c("Corn", CARB_UNFAVORABLE_VEGETABLE, ref="p0347"),
    _c("French Fries", CARB_UNFAVORABLE_VEGETABLE, ref="p0348"),
    _c("Lima beans", CARB_UNFAVORABLE_VEGETABLE, ref="p0349"),
    _c("Parsnips", CARB_UNFAVORABLE_VEGETABLE, ref="p0350"),
    _c("Peas", CARB_UNFAVORABLE_VEGETABLE, ref="p0351"),
    _c("Pinto beans", CARB_UNFAVORABLE_VEGETABLE, ref="p0352"),
    _c("Potatoes (baked, mashed, boiled, chips)", CARB_UNFAVORABLE_VEGETABLE, ref="p0353"),
    _c("Refried beans", CARB_UNFAVORABLE_VEGETABLE, ref="p0355"),
    _c("Sweet potatoes (baked, mashed, etc)", CARB_UNFAVORABLE_VEGETABLE, ref="p0356"),
    # Unfavorable Complex Carbohydrates - "Any grain or bread product is
    # unfavorable" (p0358). Quinoa appears twice in the source, once among the
    # vegetables (p0354) and once here (p0377); it is kept here because that is
    # the list the HOW TO rule names it in (p0257).
    _c("Bagel", CARB_UNFAVORABLE_GRAIN, ref="p0361"),
    _c("Biscuits", CARB_UNFAVORABLE_GRAIN, ref="p0362"),
    _c("Bread, breadcrumbs, breadsticks, croutons", CARB_UNFAVORABLE_GRAIN, ref="p0363"),
    _c("Buckwheat", CARB_UNFAVORABLE_GRAIN, ref="p0364"),
    _c("Cereal (all kinds), granola", CARB_UNFAVORABLE_GRAIN, ref="p0365"),
    _c("Cornbread", CARB_UNFAVORABLE_GRAIN, ref="p0366"),
    _c("Cornstarch", CARB_UNFAVORABLE_GRAIN, ref="p0367"),
    _c("Couscous", CARB_UNFAVORABLE_GRAIN, ref="p0368"),
    _c("Croissants, doughnuts, english muffins, rolls", CARB_UNFAVORABLE_GRAIN, ref="p0369"),
    _c("Crackers", CARB_UNFAVORABLE_GRAIN, ref="p0370"),
    _c("Grits", CARB_UNFAVORABLE_GRAIN, ref="p0371"),
    _c("Muffins", CARB_UNFAVORABLE_GRAIN, ref="p0372"),
    _c("Pancakes, waffles", CARB_UNFAVORABLE_GRAIN, ref="p0373"),
    _c("Pasta", CARB_UNFAVORABLE_GRAIN, ref="p0374"),
    _c("Popcorn", CARB_UNFAVORABLE_GRAIN, ref="p0375"),
    _c("Pretzels", CARB_UNFAVORABLE_GRAIN, ref="p0376"),
    _c("Quinoa", CARB_UNFAVORABLE_GRAIN, ref="p0377"),
    _c("Rice, rice cakes", CARB_UNFAVORABLE_GRAIN, ref="p0378"),
    _c("Taco shells, tortillas (flour/corn), tortilla chips", CARB_UNFAVORABLE_GRAIN, ref="p0379"),
    # Sweets (p0381-p0389)
    _c("Candy, candy bars, etc", CARB_UNFAVORABLE_SWEET, ref="p0382"),
    _c("Cake, cookies, baked goods", CARB_UNFAVORABLE_SWEET, ref="p0383"),
    _c("Ketchup, cocktail sauce", CARB_UNFAVORABLE_SWEET, ref="p0384"),
    _c("Honey", CARB_UNFAVORABLE_SWEET, ref="p0385"),
    _c("Jam, Jelly", CARB_UNFAVORABLE_SWEET, ref="p0386"),
    _c("Molasses", CARB_UNFAVORABLE_SWEET, ref="p0387"),
    _c("Sugar (all kinds)", CARB_UNFAVORABLE_SWEET, ref="p0388"),
    _c("Teriyaki Sauce", CARB_UNFAVORABLE_SWEET, ref="p0389"),
    # Unfavorable Fruits (p0391-p0401)
    _c("Bananas", CARB_UNFAVORABLE_FRUIT, ref="p0393"),
    _c("Cranberries, cranberry sauce", CARB_UNFAVORABLE_FRUIT, ref="p0394"),
    _c("Dried fruit (raisins, prunes, apricots, etc)", CARB_UNFAVORABLE_FRUIT, ref="p0395"),
    _c("Figs", CARB_UNFAVORABLE_FRUIT, ref="p0396"),
    _c("Guava", CARB_UNFAVORABLE_FRUIT, ref="p0397"),
    _c("Mango", CARB_UNFAVORABLE_FRUIT, ref="p0398"),
    _c("Papaya", CARB_UNFAVORABLE_FRUIT, ref="p0399"),
    _c("Fruit juice", CARB_UNFAVORABLE_FRUIT, ref="p0400"),
    _c("Vegetable juice", CARB_UNFAVORABLE_FRUIT, ref="p0401"),
    # p0403 "Alcohol, wine, beer"; the checklist splits it into three rows.
    _c("Alcohol", CARB_UNFAVORABLE_OTHER, ref="p0403"),
    _c("Beer", CARB_UNFAVORABLE_OTHER, ref="p0403"),
    _c("Wine", CARB_UNFAVORABLE_OTHER, ref="p0403"),
)

# ---- Fats (p0538-p0573) -----------------------------------------------------
FATS: tuple[FoodItem, ...] = (
    # Best: monounsaturated omega 9 (p0542-p0552)
    _f("Almond butter", FAT_BEST, "1 tsp", "p0543"),
    _f("Almonds- slivered, whole", FAT_BEST, "9 nuts", "p0544"),
    _f("Avocado", FAT_BEST, "1/4 avocado", "p0545"),
    _f("Guacamole", FAT_BEST, "2 tablespoons", "p0546"),
    _f("Macadamia nuts", FAT_BEST, "3 nuts", "p0547"),
    _f("Olive oil (extra light for cooking)", FAT_BEST, "1 tsp", "p0548"),
    _f("Olives", FAT_BEST, "9 olives", "p0549"),
    _f("Tahini", FAT_BEST, "2 tablespoons", "p0550"),
    _f("Cashews", FAT_BEST, "9 nuts", "p0551"),
    _f("Pistachios", FAT_BEST, "2 tsp", "p0552"),
    # Second best: saturated omega 9 (p0554-p0564)
    _f("Mayonnaise (regular, light)", FAT_SECOND_BEST, "1 tsp", "p0555"),
    _f("Sesame oil", FAT_SECOND_BEST, "1 tsp", "p0556"),
    _f("High oleic safflower oil", FAT_SECOND_BEST, "1 tsp", "p0557"),
    _f("Walnuts", FAT_SECOND_BEST, "9 nuts", "p0558"),
    _f("Bacon bits", FAT_SECOND_BEST, "2 TBL", "p0559"),
    _f("Butter", FAT_SECOND_BEST, "1 tsp", "p0560"),
    _f("Cream (half & half)", FAT_SECOND_BEST, "2 TBL", "p0561"),
    _f("Cream cheese", FAT_SECOND_BEST, "1 TBL", "p0562"),
    _f("Lard", FAT_SECOND_BEST, "1 tsp", "p0563"),
    _f("Sour cream", FAT_SECOND_BEST, "1 TBL", "p0564"),
    # Poor: saturated omega 6 (p0566-p0569). The "1 tsp of any of these" on
    # p0569 is written on the vegetable-oils row and attaches to it; the other
    # two rows carry no amount in the source, so they carry none here.
    _f("Canola oil /  Peanut oil / Soybean oil", FAT_POOR, ref="p0567"),
    _f("Peanuts & Peanut butter (natural)", FAT_POOR, ref="p0568"),
    _f("Vegetable oils (corn, safflower, etc)", FAT_POOR, "1 tsp", "p0569"),
    # Avoid: transfat and hydrogenated oils (p0571-p0573)
    _f("Vegetable shortening", FAT_AVOID, ref="p0572"),
    _f("Trans Fats", FAT_AVOID, ref="Fat Food Choices xlsx"),
    _f("Anything with hydrogenated or partially hydrogenated oils of any kind", FAT_AVOID, ref="p0573"),
)

ALL_ITEMS: tuple[FoodItem, ...] = PROTEINS + CARBOHYDRATES + FATS
BY_NAME: dict[str, FoodItem] = {item.name.casefold(): item for item in ALL_ITEMS}


def find(name: str) -> FoodItem | None:
    """Look a food up by its list name. Unknown names are unknown, not guessed."""
    return BY_NAME.get((name or "").strip().casefold())


def items(group: str, tier: str | None = None) -> tuple[FoodItem, ...]:
    return tuple(i for i in ALL_ITEMS if i.group == group and (tier is None or i.tier == tier))


def tiers(group: str) -> tuple[str, ...]:
    """The group's tiers in the source's order."""
    seen: list[str] = []
    for item in ALL_ITEMS:
        if item.group == group and item.tier not in seen:
            seen.append(item.tier)
    return tuple(seen)


# ---- things the source says are NOT what a member may assume ---------------
# "Legumes are not proteins.  nuts are not proteins.  for proteins, choose
# from the protein list.  beans are not proteins." (p0255, repeated p0269)
# "nuts, seeds, hemp seeds, nut butters are not protein, they are fats" (p0491)
NOT_PROTEIN_NOTE = (
    "Legumes, nuts, seeds and beans are not proteins. Nuts, seeds, hemp seeds and "
    "nut butters are fats. Proteins come from the protein list."
)
NOT_PROTEIN_REFS = ("p0255", "p0269", "p0491")

# "Do not say whole grains are healthy or favorable.  Whole grains are not
# favorable or healthy." (p0241) / "Do mot recommend whole grains or
# quinoa all whole grains are unfavorable." (p0257)
WHOLE_GRAIN_NOTE = "Whole grains and quinoa are not favourable and are not recommended."
WHOLE_GRAIN_REFS = ("p0241", "p0257", "p0334")

# "You would not add this as fat to a meal" - omega-3 fish oil (p0539).
OMEGA3_NOT_A_MEAL_FAT_NOTE = (
    "Omega-3 fish oil is not one of the fats added to a meal."
)
OMEGA3_REF = "p0539"

# "With proteins plant based is best as long as it is not raw tofu (too high
# in isoflavanoids and estrogen like properties).  Process soy or other
# sources are better." (p0489)
RAW_TOFU_NOTE = (
    "Plant-based protein is best, as long as it is not raw tofu - processed soy "
    "or another source is better."
)
RAW_TOFU_REF = "p0489"

# "Foods that have protein, carbs and fats together are greek yogurt with
# fruit, 2% milk, and soft tofu" (p0575)
ALL_THREE_FOODS = ("greek yogurt with fruit", "2% milk", "soft tofu")
ALL_THREE_REF = "p0575"

# The one inconsistency inside the source, recorded rather than reconciled.
PROTEIN_PORTION_NOTE = """\
p0249 reads: "The protein in a meal is the size and shape of your palm, so 27
to 30 ounces for a woman and 35 to 40 ounces for a man."

As ounces of food those figures are roughly nine times a palm-sized portion.
The same document's own per-food table settles it: "Protein Powder 30grams
woman, 40 grams man" (p0504) and "Soy burgers, soy dogs, soy sausage 30grams
woman, 40 grams man" (p0505) carry exactly the numbers p0249 uses, in grams.
So p0249 is describing grams of protein, and p0497-p0534 give the amount of
each food that supplies it.

This package therefore implements the per-food table and does not implement
p0249's aggregate figure at all. Nothing is converted, and no portion is
restated in a unit the source did not write for that food. The discrepancy is
logged for Cara in
Feedback_docs/VEYE_Client_Functionality_Clarifications.md.
"""
