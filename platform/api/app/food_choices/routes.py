"""Food Choices routes (member portal only).

The lists, the member's own checklist, and the HOW TO conversation. Everything
here reads `principal.member_id`; nothing accepts a member id from the client.

The HOW TO state machine lives in `how_to.py` and the rules in `rules.py` —
these routes only store and fetch. That separation is the point: the rules are
tested without a database or a model, and no screen can hold a second copy of
a portion or a tier.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth.principal import CurrentPrincipal, require_member
from app.db.session import get_db
from app.food_choices import catalog, how_to, rules
from app.food_choices.models import MemberFoodSelection, MemberHowToPlan, utcnow

router = APIRouter(prefix="/api/v1/members/me/food-choices", tags=["food-choices"])


# ---- the lists --------------------------------------------------------------

class FoodOut(BaseModel):
    name: str
    tier: str
    tier_label: str
    # The source's own wording for this person's amount, or null where it
    # states none. Never interpolated.
    portion: str | None
    favorable: bool | None
    source_ref: str


class GroupOut(BaseModel):
    group: str
    tiers: list[dict]


class CatalogOut(BaseModel):
    sex: str
    source: str
    groups: list[GroupOut]
    notes: dict[str, str]


def _food_out(item: catalog.FoodItem, sex: str, occasion: str) -> FoodOut:
    amount, ref = rules.portion_for(item, sex, occasion)
    return FoodOut(name=item.name, tier=item.tier,
                   tier_label=catalog.TIER_LABELS[item.group][item.tier],
                   portion=amount, favorable=item.favorable, source_ref=ref)


@router.get("/catalog", response_model=CatalogOut)
def food_lists(sex: str = Query(...), occasion: str = Query(default=rules.MEAL),
               principal: CurrentPrincipal = Depends(require_member)) -> CatalogOut:
    """The four client lists, with this person's amounts.

    `sex` is required rather than defaulted: every portion in the source is
    stated for a woman or for a man, and picking one would be inventing the
    member's amounts.
    """
    if sex not in catalog.SEXES:
        raise HTTPException(422,
                            detail=f"sex must be one of {', '.join(catalog.SEXES)}.")
    if occasion not in rules.OCCASIONS:
        raise HTTPException(422,
                            detail=f"occasion must be one of {', '.join(rules.OCCASIONS)}.")

    groups: list[GroupOut] = []
    for group in catalog.GROUPS:
        tiers = [
            {
                "tier": tier,
                "label": catalog.TIER_LABELS[group][tier],
                "allowance": _allowance(tier, sex),
                "foods": [_food_out(i, sex, occasion) for i in catalog.items(group, tier)],
            }
            for tier in catalog.tiers(group)
        ]
        groups.append(GroupOut(group=group, tiers=tiers))

    return CatalogOut(
        sex=sex, source=catalog.SOURCE_DOCUMENT, groups=groups,
        notes={
            "not_protein": catalog.NOT_PROTEIN_NOTE,
            "whole_grain": catalog.WHOLE_GRAIN_NOTE,
            "raw_tofu": catalog.RAW_TOFU_NOTE,
            "omega3": catalog.OMEGA3_NOT_A_MEAL_FAT_NOTE,
        },
    )


def _allowance(tier: str, sex: str) -> str | None:
    entry = catalog.TIER_ALLOWANCE.get(tier)
    if entry is None:
        return None
    return entry[0] if sex == catalog.WOMAN else entry[1]


# ---- the member's own checklist ---------------------------------------------

class SelectionsIn(BaseModel):
    sex: str = ""
    selections: dict[str, list[str]] = Field(default_factory=dict)
    write_ins: dict[str, list[str]] = Field(default_factory=dict)

    @field_validator("sex")
    @classmethod
    def _known_sex(cls, value: str) -> str:
        if value and value not in catalog.SEXES:
            raise ValueError(f"sex must be one of {', '.join(catalog.SEXES)}")
        return value

    @field_validator("selections")
    @classmethod
    def _known_foods(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        """A checked food is a name from the lists. Anything else belongs in a
        write-in, where it is recorded rather than scored."""
        cleaned: dict[str, list[str]] = {}
        for group, names in value.items():
            if group not in catalog.GROUPS:
                raise ValueError(f"Unknown group: {group}")
            resolved: list[str] = []
            for name in names:
                item = catalog.find(name)
                if item is None:
                    raise ValueError(f"{name} is not on the {group} list. Add it as a write-in instead.")
                if item.group != group:
                    raise ValueError(f"{item.name} is on the {item.group} list, not the {group} list.")
                if item.name not in resolved:
                    resolved.append(item.name)
            cleaned[group] = resolved
        return cleaned

    @field_validator("write_ins")
    @classmethod
    def _trim_write_ins(cls, value: dict[str, list[str]]) -> dict[str, list[str]]:
        """Keyed by section, as "<group>:<tier>".

        Not by tier alone: "best" and "poor" are tier names on both the
        protein list and the fat list, so a tier-only key filed one member's
        own food under two different sections of the screen.
        """
        cleaned: dict[str, list[str]] = {}
        for section, entries in value.items():
            group, _, tier = str(section).partition(":")
            if group not in catalog.GROUPS or tier not in catalog.TIER_LABELS[group]:
                raise ValueError(
                    f"{section} is not a section of the food lists. "
                    f"A write-in belongs to one, as \"<group>:<tier>\"."
                )
            texts = [str(e).strip()[:120] for e in entries if str(e).strip()]
            if texts:
                cleaned[f"{group}:{tier}"] = list(dict.fromkeys(texts))
        return cleaned


class SelectionsOut(BaseModel):
    sex: str
    selections: dict[str, list[str]]
    write_ins: dict[str, list[str]]
    # Said plainly rather than left for a screen to remember.
    write_in_note: str = (
        "Foods you add yourself are kept as you wrote them. The food lists give "
        "amounts and favourability only for the foods on them, so an added food "
        "carries neither."
    )


def _selection_row(db: Session, member_id: UUID) -> MemberFoodSelection | None:
    return (db.query(MemberFoodSelection)
            .filter(MemberFoodSelection.member_id == member_id).one_or_none())


def _selections_out(row: MemberFoodSelection | None) -> SelectionsOut:
    if row is None:
        return SelectionsOut(sex="", selections={g: [] for g in catalog.GROUPS}, write_ins={})
    selections = {g: list(row.selections.get(g, [])) for g in catalog.GROUPS}
    return SelectionsOut(sex=row.sex, selections=selections, write_ins=dict(row.write_ins or {}))


@router.get("/selections", response_model=SelectionsOut)
def read_selections(principal: CurrentPrincipal = Depends(require_member),
                    db: Session = Depends(get_db)) -> SelectionsOut:
    assert principal.member_id is not None
    return _selections_out(_selection_row(db, principal.member_id))


@router.put("/selections", response_model=SelectionsOut)
def save_selections(payload: SelectionsIn, principal: CurrentPrincipal = Depends(require_member),
                    db: Session = Depends(get_db)) -> SelectionsOut:
    assert principal.member_id is not None
    row = _selection_row(db, principal.member_id)
    if row is None:
        row = MemberFoodSelection(member_id=principal.member_id)
        db.add(row)
    row.selections = {g: payload.selections.get(g, []) for g in catalog.GROUPS}
    row.write_ins = payload.write_ins
    if payload.sex:
        row.sex = payload.sex
    db.commit()
    db.refresh(row)
    return _selections_out(row)


# ---- the HOW TO conversation -------------------------------------------------

class PromptOut(BaseModel):
    step: str
    text: str
    answer: str
    options: list[str]
    notes: list[str]
    recap: list[str]
    candidates: list[str]
    source_ref: str


class OccasionOut(BaseModel):
    kind: str
    at: str | None
    at_label: str | None
    confirmed: bool
    proteins: list[str]
    carbohydrates: list[str]
    fats: list[str]


class PlanOut(BaseModel):
    id: str
    sex: str
    step: str
    wake: str | None
    wake_label: str | None
    bedtime: str | None
    bedtime_label: str | None
    done_eating_reason: str
    occasions: list[OccasionOut]
    prompt: PromptOut
    complete: bool


class StartIn(BaseModel):
    sex: str

    @field_validator("sex")
    @classmethod
    def _known_sex(cls, value: str) -> str:
        if value not in catalog.SEXES:
            raise ValueError(f"sex must be one of {', '.join(catalog.SEXES)}")
        return value


class AnswerIn(BaseModel):
    time: str | None = None
    choice: str | None = None
    foods: list[str] | None = None
    cooked: bool | None = None

    def as_answer(self) -> dict:
        answer: dict = {}
        if self.time is not None:
            answer["time"] = self.time
        if self.choice is not None:
            answer["choice"] = self.choice
        if self.foods is not None:
            answer["foods"] = self.foods
        if self.cooked is not None:
            answer["cooked"] = self.cooked
        return answer


def _latest_plan(db: Session, member_id: UUID) -> MemberHowToPlan | None:
    """The member's current plan, finished or not.

    A finished day is still the thing they want to look at, so completion does
    not hide it — only starting another plan or discarding this one replaces
    it. `completed_at` records when the conversation reached its end.
    """
    return (db.query(MemberHowToPlan)
            .filter(MemberHowToPlan.member_id == member_id)
            .order_by(MemberHowToPlan.created_at.desc()).first())


def _plan_out(row: MemberHowToPlan) -> PlanOut:
    state = how_to.HowTo.from_dict(row.state)
    asked = how_to.prompt(state)
    return PlanOut(
        id=str(row.id), sex=state.sex, step=state.step,
        wake=state.wake, wake_label=how_to.clock_label(state.wake),
        bedtime=state.bedtime, bedtime_label=how_to.clock_label(state.bedtime),
        done_eating_reason=state.done_eating_reason,
        occasions=[
            OccasionOut(kind=o.kind, at=o.at,
                        at_label=how_to.clock_label(o.at),
                        confirmed=o.confirmed, proteins=list(o.proteins),
                        carbohydrates=list(o.carbohydrates), fats=list(o.fats))
            for o in state.occasions
        ],
        prompt=PromptOut(step=asked.step, text=asked.text, answer=asked.answer,
                         options=list(asked.options), notes=list(asked.notes),
                         recap=list(asked.recap), candidates=list(asked.candidates),
                         source_ref=asked.ref),
        complete=state.step == how_to.STEP_COMPLETE,
    )


@router.get("/how-to", response_model=PlanOut | None)
def current_plan(principal: CurrentPrincipal = Depends(require_member),
                 db: Session = Depends(get_db)) -> PlanOut | None:
    assert principal.member_id is not None
    row = _latest_plan(db, principal.member_id)
    return _plan_out(row) if row is not None else None


@router.post("/how-to", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
def start_plan(payload: StartIn, principal: CurrentPrincipal = Depends(require_member),
               db: Session = Depends(get_db)) -> PlanOut:
    """Start a plan. Any plan still open is closed, so a member has one.

    `sex` is asked for because every portion in the source is stated for a
    woman or a man. The HOW TO script itself never asks — see the
    clarifications log — so the question is the application's, and the answer
    is remembered on the member's own checklist rather than asked again.
    """
    assert principal.member_id is not None
    previous = _latest_plan(db, principal.member_id)
    if previous is not None and previous.completed_at is None:
        previous.completed_at = utcnow()

    state = how_to.start(payload.sex)
    row = MemberHowToPlan(member_id=principal.member_id, state=state.to_dict())
    db.add(row)

    selection = _selection_row(db, principal.member_id)
    if selection is None:
        selection = MemberFoodSelection(member_id=principal.member_id,
                                        selections={g: [] for g in catalog.GROUPS}, write_ins={})
        db.add(selection)
    selection.sex = payload.sex

    db.commit()
    db.refresh(row)
    return _plan_out(row)


@router.post("/how-to/answer", response_model=PlanOut)
def answer_plan(payload: AnswerIn, principal: CurrentPrincipal = Depends(require_member),
                db: Session = Depends(get_db)) -> PlanOut:
    assert principal.member_id is not None
    row = _latest_plan(db, principal.member_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="There is no plan in progress.")
    state = how_to.HowTo.from_dict(row.state)
    try:
        how_to.advance(state, payload.as_answer())
    except how_to.HowToError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    row.state = state.to_dict()
    if state.step == how_to.STEP_COMPLETE:
        row.completed_at = utcnow()
    db.commit()
    db.refresh(row)
    return _plan_out(row)


@router.delete("/how-to", status_code=status.HTTP_204_NO_CONTENT)
def discard_plan(principal: CurrentPrincipal = Depends(require_member),
                 db: Session = Depends(get_db)) -> None:
    assert principal.member_id is not None
    row = _latest_plan(db, principal.member_id)
    if row is not None:
        db.delete(row)
        db.commit()
