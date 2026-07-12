from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import get_settings
from app.models.schemas import (
    AnalyzeMediaRequest,
    AnalyzeMediaResponse,
    GenerateQuestionsRequest,
    GenerateQuestionsResponse,
    MemoryAnswerResponse,
    MemoryQuestionResponse,
    MemoryQuestionsListResponse,
    UpdateMemoryAnswerRequest,
    UpsertMemoryAnswerRequest,
)
from app.services.auth import require_authenticated_user
from app.services.authorization import (
    require_album_answer,
    require_album_read,
    require_album_regenerate_questions,
)
from app.services.membership import get_album_access
from app.services.media_analysis_service import analyze_album_media
from app.services.question_service import (
    delete_answer_record,
    generate_album_questions,
    get_answer_by_id,
    get_question_by_id,
    list_album_questions,
    list_question_answers,
    update_answer_record,
    upsert_answer,
)
from app.services.supabase import get_album_media_records, get_album_record, get_signed_url, get_supabase_client


router = APIRouter(prefix="/api", tags=["memory"])


def _answer_response(row: dict) -> MemoryAnswerResponse:
    profile = row.get("profiles") or {}
    return MemoryAnswerResponse(
        id=UUID(str(row["id"])),
        question_id=UUID(str(row["question_id"])),
        profile_id=UUID(str(row["profile_id"])),
        display_name=str(profile.get("display_name") or "가족 구성원"),
        answer=row.get("answer") or "",
        answer_type=row.get("answer_type") or "text",
        voice_url=row.get("voice_url"),
        created_at=row["created_at"],
        updated_at=row.get("updated_at") or row["created_at"],
    )


def _thumbnail_for_media(client, settings, media_records: list[dict], media_id: str) -> str | None:
    media = next((row for row in media_records if str(row["id"]) == media_id), None)
    if not media or not media.get("thumbnail_path"):
        return None
    return get_signed_url(
        client,
        settings.supabase_private_storage_bucket,
        str(media["thumbnail_path"]),
        settings.signed_url_ttl_seconds,
    )


@router.get("/albums/{album_id}/memory/questions", response_model=MemoryQuestionsListResponse)
async def get_memory_questions(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MemoryQuestionsListResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_read(access)

    question_rows = list_album_questions(client, album_id)
    answer_rows = list_question_answers(client, [str(row["id"]) for row in question_rows])
    answers_by_question: dict[str, list[dict]] = {}
    for answer in answer_rows:
        answers_by_question.setdefault(str(answer["question_id"]), []).append(answer)

    media_records = get_album_media_records(client, album_id)
    questions = [
        MemoryQuestionResponse(
            id=UUID(str(row["id"])),
            album_id=UUID(str(row["album_id"])),
            media_id=UUID(str(row["media_id"])),
            question=row["question"],
            sort_order=int(row["sort_order"]),
            status=row["status"],
            created_at=row["created_at"],
            thumbnail_url=_thumbnail_for_media(client, settings, media_records, str(row["media_id"])),
            answers=[_answer_response(answer) for answer in answers_by_question.get(str(row["id"]), [])],
        )
        for row in question_rows
    ]
    return MemoryQuestionsListResponse(
        questions=questions,
        can_regenerate=access.can_regenerate_questions,
        can_analyze_media=access.can_regenerate_questions,
    )


@router.post("/albums/{album_id}/memory/questions/generate", response_model=GenerateQuestionsResponse)
async def generate_memory_questions(
    album_id: str,
    body: GenerateQuestionsRequest | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> GenerateQuestionsResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_read(access)

    payload = body or GenerateQuestionsRequest()
    if payload.force:
        require_album_regenerate_questions(access)

    media_records = get_album_media_records(client, album_id)
    if not media_records:
        raise HTTPException(status_code=400, detail="질문을 만들 미디어가 없습니다.")

    result = await generate_album_questions(
        client,
        album_id=album_id,
        album=album,
        media_records=media_records,
        force=payload.force,
        media_id=str(payload.media_id) if payload.media_id else None,
        settings=settings,
    )
    return GenerateQuestionsResponse(
        generated_media_ids=[UUID(value) for value in result["generated_media_ids"]],
        skipped_media_ids=[UUID(value) for value in result["skipped_media_ids"]],
        question_count=int(result["question_count"]),
    )


@router.post("/albums/{album_id}/memory/questions/regenerate", response_model=GenerateQuestionsResponse)
async def regenerate_memory_questions(
    album_id: str,
    body: GenerateQuestionsRequest | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> GenerateQuestionsResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_regenerate_questions(access)

    payload = body or GenerateQuestionsRequest()
    media_records = get_album_media_records(client, album_id)
    result = await generate_album_questions(
        client,
        album_id=album_id,
        album=album,
        media_records=media_records,
        force=True,
        media_id=str(payload.media_id) if payload.media_id else None,
        settings=settings,
    )
    return GenerateQuestionsResponse(
        generated_media_ids=[UUID(value) for value in result["generated_media_ids"]],
        skipped_media_ids=[UUID(value) for value in result["skipped_media_ids"]],
        question_count=int(result["question_count"]),
    )


@router.post("/albums/{album_id}/media/analyze", response_model=AnalyzeMediaResponse)
async def analyze_media(
    album_id: str,
    body: AnalyzeMediaRequest | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AnalyzeMediaResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_regenerate_questions(access)

    payload = body or AnalyzeMediaRequest()
    media_records = get_album_media_records(client, album_id)
    if not media_records:
        raise HTTPException(status_code=400, detail="분석할 미디어가 없습니다.")

    result = await analyze_album_media(
        client,
        album_id=album_id,
        album=album,
        media_records=media_records,
        media_id=str(payload.media_id) if payload.media_id else None,
        settings=settings,
    )
    return AnalyzeMediaResponse(
        analyzed_media_ids=[UUID(value) for value in result["analyzed_media_ids"]],
        skipped_media_ids=[UUID(value) for value in result["skipped_media_ids"]],
    )


@router.put("/memory/questions/{question_id}/answers", response_model=MemoryAnswerResponse)
async def upsert_memory_answer(
    question_id: str,
    body: UpsertMemoryAnswerRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MemoryAnswerResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    question = get_question_by_id(client, question_id)
    if not question or question.get("status") != "active":
        raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
    album = get_album_record(client, str(question["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_answer(access)

    saved = upsert_answer(
        client,
        question_id=question_id,
        profile_id=authenticated_user_id,
        answer=body.answer,
        answer_type=body.answer_type,
        voice_url=body.voice_url,
    )
    rows = list_question_answers(client, [question_id])
    for row in rows:
        if str(row["profile_id"]) == authenticated_user_id:
            return _answer_response(row)
    raise HTTPException(status_code=500, detail="답변을 저장하지 못했습니다.")


@router.patch("/memory/answers/{answer_id}", response_model=MemoryAnswerResponse)
async def patch_memory_answer(
    answer_id: str,
    body: UpdateMemoryAnswerRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MemoryAnswerResponse:
    settings = get_settings()
    client = get_supabase_client(settings)
    answer = get_answer_by_id(client, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="답변을 찾을 수 없습니다.")
    question = get_question_by_id(client, str(answer["question_id"]))
    if not question:
        raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
    album = get_album_record(client, str(question["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    if str(answer["profile_id"]) != authenticated_user_id and not access.can_edit_settings:
        raise HTTPException(status_code=403, detail="You do not have permission to edit this answer.")

    patch = {"answer": body.answer.strip()}
    if body.answer_type is not None:
        patch["answer_type"] = body.answer_type
    if body.voice_url is not None:
        patch["voice_url"] = body.voice_url
    updated = update_answer_record(client, answer_id, patch)
    rows = list_question_answers(client, [str(answer["question_id"])])
    for row in rows:
        if str(row["id"]) == answer_id:
            return _answer_response(row)
    return _answer_response(updated or answer)


@router.delete("/memory/answers/{answer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory_answer(
    answer_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> None:
    client = get_supabase_client()
    answer = get_answer_by_id(client, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="답변을 찾을 수 없습니다.")
    question = get_question_by_id(client, str(answer["question_id"]))
    if not question:
        raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
    album = get_album_record(client, str(question["album_id"]))
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    if str(answer["profile_id"]) != authenticated_user_id and not access.can_edit_settings:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this answer.")
    delete_answer_record(client, answer_id)
