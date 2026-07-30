from pydantic import BaseModel, Field


class BrandGenerateRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=500, examples=["가족 사진 앨범"])


class BrandResultItem(BaseModel):
    brand: str
    score: int
    domain: bool
    pronunciation: str
    reason: str


class BrandGenerateResponse(BaseModel):
    results: list[BrandResultItem]


class BrandProgressEvent(BaseModel):
    step: int
    message: str
