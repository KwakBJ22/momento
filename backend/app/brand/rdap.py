"""Async RDAP .com domain availability checker."""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.brand.cache import get_domain_cache

logger = logging.getLogger(__name__)

RDAP_ENDPOINTS = (
    "https://rdap.verisign.com/com/v1/domain/{domain}",
    "https://rdap.org/domain/{domain}",
)

DEFAULT_CONCURRENCY = 15
DEFAULT_DELAY_SECONDS = 0.05
REQUEST_TIMEOUT = 8.0
BATCH_SIZE = 30


class RdapService:
    """Check .com availability via RDAP with caching and rate limiting."""

    def __init__(
        self,
        *,
        concurrency: int = DEFAULT_CONCURRENCY,
        delay_seconds: float = DEFAULT_DELAY_SECONDS,
    ) -> None:
        self._semaphore = asyncio.Semaphore(concurrency)
        self._delay = delay_seconds
        self._cache = get_domain_cache()

    @staticmethod
    def _normalize(brand: str) -> str:
        return f"{brand.lower().strip()}.com"

    async def _check_single(self, client: httpx.AsyncClient, domain: str) -> bool:
        cached = self._cache.get(domain)
        if cached is not None:
            return cached

        async with self._semaphore:
            if self._delay > 0:
                await asyncio.sleep(self._delay)
            available = await self._query_rdap(client, domain)
            self._cache.set(domain, available)
            return available

    async def _query_rdap(self, client: httpx.AsyncClient, domain: str) -> bool:
        domain_upper = domain.upper()
        for template in RDAP_ENDPOINTS:
            url = template.format(domain=domain_upper)
            try:
                response = await client.get(url, follow_redirects=True)
            except httpx.HTTPError as exc:
                logger.warning("rdap_request_failed domain=%s error=%s", domain, type(exc).__name__)
                continue

            if response.status_code == 404:
                return True
            if response.status_code == 200:
                return False
            if response.status_code == 429:
                await asyncio.sleep(1.0)
                continue

        logger.warning("rdap_inconclusive domain=%s", domain)
        return False

    async def find_available(
        self,
        brands: list[str],
        *,
        target_count: int = 20,
    ) -> list[tuple[str, bool]]:
        """Check brands in order; return pairs until target_count available domains found."""
        results: list[tuple[str, bool]] = []
        available_count = 0

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            index = 0
            while index < len(brands) and available_count < target_count:
                batch = brands[index : index + BATCH_SIZE]
                index += BATCH_SIZE

                checked = await asyncio.gather(
                    *[self._check_brand(client, brand) for brand in batch]
                )
                for brand, is_available in checked:
                    results.append((brand, is_available))
                    if is_available:
                        available_count += 1
                        if available_count >= target_count:
                            break

        return results

    async def _check_brand(self, client: httpx.AsyncClient, brand: str) -> tuple[str, bool]:
        domain = self._normalize(brand)
        available = await self._check_single(client, domain)
        return brand, available

    async def check_one(self, brand: str) -> bool:
        domain = self._normalize(brand)
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            return await self._check_single(client, domain)


_rdap: RdapService | None = None


def get_rdap_service() -> RdapService:
    global _rdap
    if _rdap is None:
        _rdap = RdapService()
    return _rdap
