from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.analytics_service import insert_analytics_event
from app.services.operations import get_operation_id, operation_context


class OperationContextTests(TestCase):
    def test_operation_context_binds_and_restores_an_operation_id(self) -> None:
        self.assertIsNone(get_operation_id())
        with operation_context("test.operation", operation_id="operation-1"):
            self.assertEqual(get_operation_id(), "operation-1")
        self.assertIsNone(get_operation_id())

    def test_event_logger_adds_current_operation_id_without_changing_schema(self) -> None:
        client = MagicMock()
        client.table.return_value.insert.return_value.execute.return_value = None
        with operation_context("test.event", operation_id="operation-2"):
            self.assertTrue(insert_analytics_event(client, "album_created", metadata={"photo_count": 2}))
        row = client.table.return_value.insert.call_args.args[0]
        self.assertEqual(row["metadata"]["operation_id"], "operation-2")
        self.assertEqual(row["metadata"]["operation_name"], "test.event")
        self.assertEqual(row["metadata"]["photo_count"], 2)


class OperationsCliTests(TestCase):
    @patch("app.operations_cli.get_supabase_client")
    @patch("app.operations_cli.get_settings")
    @patch("app.operations_cli.cleanup_storage")
    @patch("app.operations_cli.cleanup_temp")
    def test_scheduled_cleanup_is_dry_run_without_explicit_environment(
        self, cleanup_temp, cleanup_storage, get_settings, get_client
    ) -> None:
        from argparse import Namespace
        from app.operations_cli import run_command

        get_settings.return_value = SimpleNamespace()
        get_client.return_value = MagicMock()
        cleanup_temp.return_value = {"status": "ok", "executed": False}
        cleanup_storage.return_value = {"status": "ok", "executed": False}
        with patch.dict("os.environ", {}, clear=True):
            report, status = run_command(Namespace(command="scheduled_cleanup", album_id=None, limit=10, execute=False))
        self.assertEqual(status, 0)
        self.assertTrue(report["scheduled"])
        self.assertFalse(cleanup_temp.call_args.kwargs["execute"])
        self.assertFalse(cleanup_storage.call_args.kwargs["execute"])
