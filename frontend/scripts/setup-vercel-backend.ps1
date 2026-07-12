param(
  [Parameter(Mandatory = $true)]
  [string]$BackendUrl
)

# Railway 배포 후 백엔드 URL을 Vercel에 등록하는 스크립트
# 사용 예:
#   cd frontend
#   .\scripts\setup-vercel-backend.ps1 -BackendUrl "https://momento-api-production.up.railway.app"

$BackendUrl = $BackendUrl.TrimEnd("/")

Write-Host "Vercel에 MOMENTO_API_URL 설정 중: $BackendUrl"

$common = @("--yes", "--force", "--no-sensitive", "--non-interactive")

vercel env add MOMENTO_API_URL production --value $BackendUrl @common
# Preview: Git 브랜치 미지정 = 모든 Preview 브랜치에 적용
vercel env add MOMENTO_API_URL preview --value $BackendUrl @common
vercel env add MOMENTO_API_URL development --value "http://localhost:8000" @common

Write-Host ""
Write-Host "완료! 프로덕션 재배포가 필요합니다:"
Write-Host "  vercel --prod --yes"
Write-Host ""
Write-Host "백엔드(Railway) URL: $BackendUrl"
