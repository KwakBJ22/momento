from unittest import TestCase

from app.config import PRODUCTION_SUPABASE_REF, Settings


def settings_for(supabase_url: str, **extra: object) -> Settings:
    return Settings(
        supabase_url=supabase_url,
        supabase_service_role_key="service-role-key",
        **extra,  # type: ignore[arg-type]
    )


class DeploymentEnvironmentTests(TestCase):
    """지금 붙어 있는 데이터가 운영인지 아닌지 — 관리자 화면의 띠가 이것 하나를 본다.

    ★ /admin 에는 앨범 삭제 버튼이 있고 개발·운영 화면이 똑같이 생겼다.
      헷갈려서 운영 앨범을 지우면 되돌릴 수 없다.
    ★ 판정 근거는 **Supabase 프로젝트 ref** 다. 어느 데이터를 지우게 되는지를 정하는 값이
      그것이기 때문이다. 주소나 배포 이름은 바뀌지만, 바뀌어도 지워지는 데이터는
      그 프로젝트의 것이다.
    """

    def test_production_project_is_production(self) -> None:
        settings = settings_for(f"https://{PRODUCTION_SUPABASE_REF}.supabase.co")
        self.assertEqual(settings.supabase_project_ref, PRODUCTION_SUPABASE_REF)
        self.assertEqual(settings.deployment_environment, "production")

    def test_development_project_is_development(self) -> None:
        settings = settings_for("https://rledlhgycwzmtldcuram.supabase.co")
        self.assertEqual(settings.deployment_environment, "development")

    def test_unknown_project_is_treated_as_development(self) -> None:
        """★ 모르는 곳은 전부 개발로 본다 — 헷갈릴 때 띠가 뜨는 쪽이 안전하다."""
        settings = settings_for("https://some-new-project.supabase.co")
        self.assertEqual(settings.deployment_environment, "development")

    def test_environment_variable_cannot_disguise_the_project(self) -> None:
        """★ ENVIRONMENT 변수로 판정하지 않는다.

        그 값은 안 넣어도 기본이 `development` 라, 운영에서 변수를 빠뜨리면 운영이
        개발로 보인다. 반대로 개발에 `production` 을 적어 넣어도 띠가 사라지면 안 된다.
        """
        disguised = settings_for("https://rledlhgycwzmtldcuram.supabase.co", environment="production")
        self.assertEqual(disguised.deployment_environment, "development")

        forgotten = settings_for(f"https://{PRODUCTION_SUPABASE_REF}.supabase.co", environment="")
        self.assertEqual(forgotten.deployment_environment, "production")

    def test_ref_is_read_from_odd_shaped_urls(self) -> None:
        for url in (
            f"https://{PRODUCTION_SUPABASE_REF}.supabase.co/",
            f"HTTPS://{PRODUCTION_SUPABASE_REF.upper()}.supabase.co",
            f"  https://{PRODUCTION_SUPABASE_REF}.supabase.co/rest/v1  ",
        ):
            with self.subTest(url=url):
                self.assertEqual(settings_for(url).deployment_environment, "production")
