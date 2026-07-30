import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.brand.engine import get_brand_engine
from app.models.brand_schemas import BrandGenerateRequest, BrandGenerateResponse, BrandResultItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["brand"])


@router.post("/generate", response_model=BrandGenerateResponse)
async def generate_brands(request: BrandGenerateRequest) -> BrandGenerateResponse:
    """Generate available .com brand names from a service description."""
    engine = get_brand_engine()
    results = await engine.generate(request.description)
    return BrandGenerateResponse(
        results=[
            BrandResultItem(
                brand=item.brand,
                score=item.score,
                domain=item.domain,
                pronunciation=item.pronunciation,
                reason=item.reason,
            )
            for item in results
        ]
    )


async def _sse_stream(description: str) -> AsyncIterator[str]:
    engine = get_brand_engine()
    async for event in engine.generate_stream(description):
        if event["type"] == "progress":
            payload = json.dumps({"step": event["step"], "message": event["message"]}, ensure_ascii=False)
            yield f"event: progress\ndata: {payload}\n\n"
        elif event["type"] == "result":
            payload = json.dumps({"results": event["results"]}, ensure_ascii=False)
            yield f"event: result\ndata: {payload}\n\n"


@router.post("/generate/stream")
async def generate_brands_stream(request: BrandGenerateRequest) -> StreamingResponse:
    """SSE stream with progress steps and final results."""
    return StreamingResponse(
        _sse_stream(request.description),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
