"""Care Studio and Content seed — the client-approved member content the
prototype already prints (build/dashboard.html Fitness, Supplements and
Resources views; build/help.html FAQ), loaded once as rows Cara can manage.
Idempotent: an item that already exists (by kind + title, or group + key) is
never overwritten, so console edits survive a restart."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.care.models import STATUS_DRAFT, STATUS_PUBLISHED, CareContentItem
from app.content.models import ContentEntry
from app.db.session import SessionLocal
from app.seed.content_data import HELP_FAQ, MEMBER_COPY

SEED_BY = "Seed (client-approved prototype content)"

# The Supplements card's polyphenol lines, as the approved prototype prints
# them (owner decision 15 Nov 2026). The prototype's Blood Markers and
# body-composition screens also give a 1500 mg line; the Supplements card
# does not, and this follows the card (asked of Cara in the clarifications log).
POLYPHENOL_BODY = '500mg helps reduce oxidative stress\n1000mg helps reduce inflammation'
POLYPHENOL_BODY_BEFORE_15_NOV = ("500mg helps reduce oxidative stress\n1000mg helps reduce inflammation\n"
                                 "1500mg helps reduce the rate of aging and increases mitochondrial synthesis")

# The Vitamin Overview behind "Other Supplements", word for word from the
# approved prototype (build/dashboard.html #supOtherPanel). A paragraph that
# starts with **Name** is drawn with that name in bold, as the prototype does.
VITAMIN_OVERVIEW_BODY = (
    'Here is a quick look at some of the major vitamins and minerals. Studies indicate potential benefits and adverse effects of vitamins and minerals:\n\n'
    '**Vitamin D** may help prevent winter illnesses like colds and flu (this benefit was shown for post-menopausal women). Some people with low vitamin D levels might experience improvement in joint or muscle pain, depression or immunity when taking vitamin D. Vitamin D could help reduce the risk of falls and fractures in elderly people and improve dental health. Vitamin D may also help reduce the risk of breast cancer in post-menopausal women and of colon cancer in men and women. Too much Vitamin D can increase the risk of kidney stones.\n\n'
    '**Vitamin B12** is an essential nutrient that helps form red blood cells, supports brain function, and makes DNA. The main pros of getting enough B12 are high energy and healthy nerves if you are deficient, while the main cons are that extra amounts do nothing if your levels are normal and high doses can cause mild side effects.\n\n'
    '**Vitamin C** supplements might decrease the risk of cataracts and the severity of colds and protect the stomach from the irritant effects of aspirin. High doses of vitamin C may cause stomach pain or diarrhea.\n\n'
    '**Vitamin A** supplements (in the form of retinol) may boost immune responses and decrease the severity of acne, and too much vitamin A can cause liver disease, bone loss, dry skin and headaches.\n\n'
    '**Beta-carotene** supplements (a precursor of vitamin A) may help decrease the risk of colon cancer and improve immune function in the elderly, but they were shown to increase the risk of lung cancer in smokers and to interfere with the benefits of statin drugs, which are used to reduce cholesterol. One problem with beta-carotene supplements is that there are many related nutrients called carotenoids, which have more powerful effects than beta-carotene. Taking beta-carotene may reduce the blood level of these other carotenoids (lutein, lycopene, astaxanthin, cryptoxanthin, alpha-carotene).\n\n'
    '**Vitamin E** supplements may either improve or hinder strong immune responses in the elderly. Vitamin E can interfere with the benefits of statin drugs, which are used for reducing cholesterol levels. One problem with vitamin E supplements is that there are many related molecules, called tocopherols, which make up the vitamin E family. Most studies use a synthetic form of vitamin E called d, l-alphatocopherol. The natural form of alphatocopherol is d-alphatocopherol and giving d, l-alphatocopherol may be the wrong way to test the effects of vitamin E. In addition, there are other tocopherols (beta, gamma and delta tocopherols) that may have important effects in the body. Taking any form of alphatocopherol can reduce the blood levels of these other tocopherols. Gamma tocopherol is a more potent antioxidant than alphatocopherol and is the major tocopherol in the U.S. diet.\n\n'
    '**Zinc** supplements, along with vitamin B6, selenium and lutein may reduce the risk or severity of macular degeneration, the leading cause of blindiness in the US. Zinc may also improve immunity and healing, reduce severity of acne and help antidepressants work better, especially for people with low levels of zinc in plasma. High doses of zinc have been used to treat tinnitus and to prevent sickle crises in people with sick cell anemia. Too much zinc can create a deficiency of copper, which may adversely affect neurological function, thyroid function and bone health.\n\n'
    '**Boron** is a trace mineral with positive effects on bone health and estrogen function. Boron supplements may help prevent or reverse bone loss and may help to prevent prostate cancer.\n\n'
    '**Vitamin K** is essential for blood clotting. Vitamin K also has beneficial effects on bone strength. Vitamin K comes in two natural forms called vitamin K1 (derived from plants and bacteria) and vitamin K2 (made by animals from vitamin K1). Vitamin K supplements have been shown in studies to reduce the risk of osteoporosis and certain kinds of cancer.\n\n'
    '**Calcium** supplements may decrease the risk of osteoporosis and fractures (along with Magnesium) and may reduce blood pressure. Calcium supplements may either decrease or increase the risk of kidney stones, depending upon dietary and genetic risk factors for stones. Some studies but not others have suggested that high calcium may increase a man’s risk of prostate cancer. Chewable, powdered or liquid calcium can help prevent or relieve GERD, or heartburn. Calcium supplements can be constipating.\n\n'
    '**Selenium** supplements in the form of selenomethionine may help reduce the incidence of asthma, breast cancer and prostate cancer. Selenium may help statin drugs (used to reduce cholesterol) work better. One study found that selenium supplements were associated with an increased risk of skin cancer.'
)
VITAMIN_OVERVIEW_BODY_BEFORE_15_NOV = ("See the approved Vitamin Overview text in the member Supplements section; "
                                       "it is published here as a draft until citations and clinical review are supplied.")

CARE_ITEMS = [
    # ---- Fitness (Dashboard edits.docx, FITNESS — Cara's three recommendations) ----
    {"kind": "fitness", "title": "Interested in Martial Arts and Boxing?", "category": "Martial Arts & Boxing",
     "content_type": "program", "description": "VEYE recommends the EYR System.",
     "external_url": "https://withme.so/EngageYourRage", "display_order": 1, "status": STATUS_PUBLISHED,
     "source": "Cara — Dashboard edits.docx (FITNESS), 17 Sep 2026"},
    {"kind": "fitness", "title": "Here are 5 exercises to avoid", "category": "Exercise guidance", "content_type": "video",
     "description": "", "youtube_url": "https://youtu.be/XLlHJ5-vHWw", "display_order": 2, "status": STATUS_PUBLISHED,
     "source": "Cara — YouTube channel video \"5 Exercises to Avoid #1\" (verified 17 Sep 2026)"},
    {"kind": "fitness", "title": "Need to improve your range of motion?", "category": "Range of Motion", "content_type": "video",
     "description": "VEYE recommends the NeoRomX System.", "youtube_url": "https://youtu.be/7YLttuiwGvw", "display_order": 3,
     "status": STATUS_PUBLISHED, "source": "Cara — YouTube channel video \"NeoRomX for increased range of motion\" (verified 17 Sep 2026)"},
    # ---- Supplements (client 20 Aug 2026 package) ----
    {"kind": "supplement", "title": "Veye supplement information", "category": "Overview", "content_type": "copy",
     "description": "While you cannot fix a macronutrient issue with micronutrients, with an anti-inflammation diet supplements can enhance your health.",
     "body": ("It is important to remember that a balanced diet is the first step to health management. Trying to undo or reverse the effects of an unbalanced diet with supplements will not work.\n\n"
              "Although there are a myriad of supplements that can enhance your health, Veye recommends the two most important ones: Omega 3 fatty acids DHA/EPA, and Polyphenols.\n\n"
              "The best source of DHA/EPA are pharmaceutical grade fish oils (not just purified or molecular distilled). For vegetarians and vegans, try an algae based DHA source. Omega 3 fatty acids reduce unresolved inflammation.\n\n"
              "Polyphenols can be from berries, cacao, or other sources. High dose polyphenols allow for increased AMPK (metabolism) activity."),
     "cautions": "For educational purposes only. Not medical advice. Consult your healthcare provider.",
     "display_order": 1, "status": STATUS_PUBLISHED, "source": "Client package 20 Aug 2026 (Supplements)"},
    {"kind": "supplement", "title": "EPA/DHA suggested dosage", "category": "Omega 3", "content_type": "copy",
     "description": "Dosage is chosen by condition, never inferred from a tracker.",
     "body": "No chronic disease: 2.5g\nOverweight/obese, type II diabetes, CHD etc: 5g\nChronic pain: 7.5g\nNeurological disorders: 10g",
     "cautions": "For educational purposes only. Not medical advice. Consult your healthcare provider.",
     "display_order": 2, "status": STATUS_PUBLISHED, "source": "Client package 20 Aug 2026 (Supplements)"},
    {"kind": "supplement", "title": "Polyphenol suggested dosage", "category": "Polyphenols", "content_type": "copy",
     "description": "The same for every result.",
     "body": POLYPHENOL_BODY,
     "cautions": "For educational purposes only. Not medical advice. Consult your healthcare provider.",
     "display_order": 3, "status": STATUS_PUBLISHED, "source": "Client package 20 Aug 2026 (Supplements)"},
    {"kind": "supplement", "title": "Individual vitamin pros and cons", "category": "Other supplements", "content_type": "article",
     "description": "Provisional educational content supplied by the Veye team — pending citation and clinical review.",
     "body": VITAMIN_OVERVIEW_BODY,
     "cautions": "Pending citation and clinical review. For educational purposes only. Not medical advice.",
     # Published, as the approved prototype shows it behind "Other Supplements"
     # with its provisional line (owner, 15 Nov 2026).
     "display_order": 4, "status": STATUS_PUBLISHED, "source": "Client package 20 Aug 2026 (Vitamin overview)"},
    # ---- Resources (the four approved cards; content not yet supplied → Draft / Coming soon) ----
    {"kind": "resource", "title": "Blogs", "category": "Resources", "content_type": "link",
     "description": "Veye contributors comment on a number of factors related to wellness. Read our regularly updated articles and view the videos that interest you. Not seeing what interests you? Let us know and we will create a post with your interests in mind.",
     "display_order": 1, "status": STATUS_DRAFT, "source": "Approved Resources card (content to be supplied)"},
    {"kind": "resource", "title": "Lifestyle", "category": "Resources", "content_type": "link",
     "description": "Explore media that focuses on daily living, personal interests, and hobbies. Veye topics include fashion, food, travel, wellness, plastic surgery, and even home decor. Want recipes, cooking tips, and tips for dining out? We have that, too.",
     "display_order": 2, "status": STATUS_DRAFT, "source": "Approved Resources card (content to be supplied)"},
    {"kind": "resource", "title": "Articles", "category": "Resources", "content_type": "article",
     "description": "Research papers, excerpts, and articles giving you insight to the science behind the Veye program. Want academic or accessible, expert content or beginner guides, advanced research or quick reads? Veye has it all.",
     "display_order": 3, "status": STATUS_DRAFT, "source": "Approved Resources card (content to be supplied)"},
    {"kind": "resource", "title": "Biohacks", "category": "Resources", "content_type": "article",
     "description": "Interested in making intentional changes to your exercise routine, lifestyle, or environment to optimize your physical and mental performance? Often called \"do-it-yourself biology\", Biohacks use science, data, and self-experimentation to take a proactive role in health and longevity. Discover Veye offerings and recommendations.",
     "display_order": 4, "status": STATUS_DRAFT, "source": "Approved Resources card (content to be supplied)"},
]


def seed_care(db: Session | None = None) -> dict[str, int]:
    own = db is None
    db = db or SessionLocal()
    created = {"care_items": 0, "content_entries": 0}
    try:
        now = datetime.now(timezone.utc)
        for data in CARE_ITEMS:
            exists = db.query(CareContentItem).filter(CareContentItem.kind == data["kind"], CareContentItem.title == data["title"]).first()
            if exists is not None:
                continue
            status = data.get("status", STATUS_DRAFT)
            item = CareContentItem(**{k: v for k, v in data.items() if k != "status"}, status=status, updated_by=SEED_BY,
                                   published_at=now if status == STATUS_PUBLISHED else None,
                                   published_by=SEED_BY if status == STATUS_PUBLISHED else None)
            db.add(item)
            created["care_items"] += 1
        # Rows this seed wrote and nobody has edited since (still the seed's
        # author and its old words) follow the seed; a console edit is never
        # overwritten.
        for kind, title, before, fields in (
                ("supplement", "Polyphenol suggested dosage", POLYPHENOL_BODY_BEFORE_15_NOV, {"body": POLYPHENOL_BODY}),
                ("supplement", "Individual vitamin pros and cons", VITAMIN_OVERVIEW_BODY_BEFORE_15_NOV,
                 {"body": VITAMIN_OVERVIEW_BODY, "status": STATUS_PUBLISHED})):
            row = db.query(CareContentItem).filter(CareContentItem.kind == kind, CareContentItem.title == title).first()
            if row is None or row.updated_by != SEED_BY or row.body != before:
                continue
            for name, value in fields.items():
                setattr(row, name, value)
            if row.status == STATUS_PUBLISHED and row.published_at is None:
                row.published_at, row.published_by = now, SEED_BY
            created["care_items_upgraded"] = created.get("care_items_upgraded", 0) + 1
        for group, entries, source in (("help_faq", HELP_FAQ, "build/help.html (client-approved FAQ)"),
                                       ("member_copy", MEMBER_COPY, "Approved member screens (build/dashboard.html)")):
            for data in entries:
                exists = db.query(ContentEntry).filter(ContentEntry.group == group, ContentEntry.key == data["key"]).first()
                if exists is not None:
                    continue
                status = data.get("status", STATUS_PUBLISHED)
                db.add(ContentEntry(group=group, key=data["key"], category=data.get("category"), title=data["title"], body=data["body"],
                                    display_order=data.get("display_order", 0), status=status, source=source,
                                    updated_by=SEED_BY, published_at=now if status == STATUS_PUBLISHED else None,
                                    published_by=SEED_BY if status == STATUS_PUBLISHED else None))
                created["content_entries"] += 1
        # Sprout's welcome lines are edited in Companion → Settings (companion_settings)
        # and were duplicated here by the 19 Sep seed; retire the copies so there is
        # one place to change them. Only untouched seed rows are archived.
        for key in ("companion_first_visit_welcome", "companion_returning_welcome"):
            row = db.query(ContentEntry).filter(ContentEntry.group == "member_copy", ContentEntry.key == key).first()
            if row is not None and row.status == STATUS_PUBLISHED and row.updated_by == SEED_BY:
                row.status = "Archived"
                row.source = "Managed in Companion → Settings (companion_settings); archived here to keep one source of truth."
        db.commit()
        return created
    finally:
        if own:
            db.close()
