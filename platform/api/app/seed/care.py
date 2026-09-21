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
     "body": "500mg helps reduce oxidative stress\n1000mg helps reduce inflammation\n1500mg helps reduce the rate of aging and increases mitochondrial synthesis",
     "cautions": "For educational purposes only. Not medical advice. Consult your healthcare provider.",
     "display_order": 3, "status": STATUS_PUBLISHED, "source": "Client package 20 Aug 2026 (Supplements)"},
    {"kind": "supplement", "title": "Individual vitamin pros and cons", "category": "Other supplements", "content_type": "article",
     "description": "Provisional educational content supplied by the Veye team — pending citation and clinical review.",
     "body": "See the approved Vitamin Overview text in the member Supplements section; it is published here as a draft until citations and clinical review are supplied.",
     "cautions": "Pending citation and clinical review. For educational purposes only. Not medical advice.",
     "display_order": 4, "status": STATUS_DRAFT, "source": "Client package 20 Aug 2026 (Vitamin overview)"},
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
