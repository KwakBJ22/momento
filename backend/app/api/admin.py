from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.config import get_settings
from app.models.schemas import (
    AdminAccessResponse,
    AdminAlbumDetailResponse,
    AdminAlbumSearchResponse,
    AdminCostDashboardResponse,
    AdminErrorDashboardResponse,
    AdminEventLogResponse,
    AdminGrowthDashboardResponse,
    AdminInvestorDashboardResponse,
    AdminOpsDashboardResponse,
    AdminUserAlbumsResponse,
    AdminUserSearchResponse,
    AdminViralFunnelResponse,
)
from app.services.admin_service import (
    admin_delete_album,
    build_cost_dashboard,
    build_growth_dashboard,
    build_investor_dashboard,
    build_ops_dashboard,
    build_viral_funnel,
    get_album_admin_detail,
    list_error_dashboard,
    list_recent_events,
    list_user_albums,
    search_albums,
    search_users,
)
from app.services.auth import require_platform_admin
from app.services.supabase import get_supabase_client

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/me", response_model=AdminAccessResponse)
async def admin_me(admin_user_id: str = Depends(require_platform_admin)) -> AdminAccessResponse:
    return AdminAccessResponse(user_id=admin_user_id)


@router.get("/dashboard", response_model=AdminOpsDashboardResponse)
async def admin_ops_dashboard(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminOpsDashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    payload = build_ops_dashboard(client, get_settings())
    return AdminOpsDashboardResponse(**payload)


@router.get("/growth", response_model=AdminGrowthDashboardResponse)
async def admin_growth_dashboard(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminGrowthDashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminGrowthDashboardResponse(**build_growth_dashboard(client))


@router.get("/investor", response_model=AdminInvestorDashboardResponse)
async def admin_investor_dashboard(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminInvestorDashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminInvestorDashboardResponse(**build_investor_dashboard(client))


@router.get("/viral-funnel", response_model=AdminViralFunnelResponse)
async def admin_viral_funnel(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminViralFunnelResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminViralFunnelResponse(**build_viral_funnel(client))


@router.get("/albums", response_model=AdminAlbumSearchResponse)
async def admin_search_albums(
    response: Response,
    q: str = Query("", max_length=120),
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: str = Depends(require_platform_admin),
) -> AdminAlbumSearchResponse:
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    client = get_supabase_client(settings)
    return AdminAlbumSearchResponse(**search_albums(client, settings, query=q, limit=limit, offset=offset))


@router.get("/albums/{album_id}", response_model=AdminAlbumDetailResponse)
async def admin_album_detail(
    album_id: str,
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminAlbumDetailResponse:
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    client = get_supabase_client(settings)
    detail = get_album_admin_detail(client, settings, album_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앨범을 찾을 수 없습니다.")
    return AdminAlbumDetailResponse(**detail)


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_album_endpoint(album_id: str, _: str = Depends(require_platform_admin)) -> None:
    client = get_supabase_client(get_settings())
    detail = get_album_admin_detail(client, get_settings(), album_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="앨범을 찾을 수 없습니다.")
    admin_delete_album(client, album_id)


@router.get("/users", response_model=AdminUserSearchResponse)
async def admin_search_users(
    response: Response,
    q: str = Query("", max_length=120),
    limit: int = Query(40, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: str = Depends(require_platform_admin),
) -> AdminUserSearchResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminUserSearchResponse(**search_users(client, query=q, limit=limit, offset=offset))


@router.get("/users/{user_id}/albums", response_model=AdminUserAlbumsResponse)
async def admin_user_albums(
    user_id: str,
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminUserAlbumsResponse:
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    client = get_supabase_client(settings)
    return AdminUserAlbumsResponse(**list_user_albums(client, settings, user_id))


@router.get("/events", response_model=AdminEventLogResponse)
async def admin_event_log(
    response: Response,
    limit: int = Query(80, ge=1, le=200),
    _: str = Depends(require_platform_admin),
) -> AdminEventLogResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminEventLogResponse(**list_recent_events(client, limit=limit))


@router.get("/errors", response_model=AdminErrorDashboardResponse)
async def admin_errors(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminErrorDashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminErrorDashboardResponse(**list_error_dashboard(client))


@router.get("/costs", response_model=AdminCostDashboardResponse)
async def admin_costs(
    response: Response,
    _: str = Depends(require_platform_admin),
) -> AdminCostDashboardResponse:
    response.headers["Cache-Control"] = "no-store"
    client = get_supabase_client(get_settings())
    return AdminCostDashboardResponse(**build_cost_dashboard(client))
