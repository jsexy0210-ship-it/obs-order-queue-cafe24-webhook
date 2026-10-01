import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("remote_deploy", Path(__file__).with_name("remote-deploy.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class RemoteDeploymentConfigurationTests(unittest.TestCase):
    def config(self):
        return {
            "MANGO_DEPLOY_HOST": "production.example.test",
            "MANGO_DEPLOY_USER": "operator",
            "MANGO_DEPLOY_SSH_KEY": "test-key",
            "MANGO_DEPLOY_KNOWN_HOSTS": "test-host-key",
            "MANGO_DEPLOY_APP_PATH": "C:\\apps\\mangotcg",
        }

    def test_missing_configuration_never_contacts_server(self):
        with patch.dict(deploy.os.environ, {}, clear=True), patch.object(deploy.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "Missing GitHub production secrets"):
                deploy.main()
            run.assert_not_called()

    def test_default_port(self):
        self.assertEqual(deploy.configuration(self.config())["PORT"], "22")

    def test_host_cannot_inject_ssh_options(self):
        config = self.config()
        config["MANGO_DEPLOY_HOST"] = "server\n  StrictHostKeyChecking no"
        with self.assertRaises(ValueError):
            deploy.configuration(config)

    def test_username_cannot_inject_ssh_options(self):
        config = self.config()
        config["MANGO_DEPLOY_USER"] = "user\n  ProxyCommand arbitrary"
        with self.assertRaises(ValueError):
            deploy.configuration(config)

    def test_port_must_be_numeric_and_in_range(self):
        for value in ("0", "65536", "22 -o option", "abc"):
            with self.subTest(value=value):
                config = self.config()
                config["MANGO_DEPLOY_PORT"] = value
                with self.assertRaises(ValueError):
                    deploy.configuration(config)

    def test_explicit_absolute_target_is_required(self):
        for value in ("relative-path", "C:\\apps\nextra", "/tmp\nproject"):
            with self.subTest(value=value):
                config = self.config()
                config["MANGO_DEPLOY_APP_PATH"] = value
                with self.assertRaises(ValueError):
                    deploy.configuration(config)

    def test_linux_target_is_supported(self):
        config = self.config()
        config["MANGO_DEPLOY_APP_PATH"] = "/srv/mangotcg"
        self.assertEqual(deploy.configuration(config)["PLATFORM"], "linux")

    def test_linux_preflight_preserves_active_and_data_bearing_releases(self):
        script = deploy.linux_deploy_preflight_script()
        self.assertIn('"$stale" != "$current"', script)
        self.assertIn('! -e "$stale/.next/BUILD_ID"', script)
        self.assertIn('! -e "$stale/data" && ! -L "$stale/data"', script)
        self.assertIn('rm -rf -- "$stale"', script)

    def test_powershell_path_is_literal(self):
        self.assertEqual(deploy.ps_quote("C:\\team's app; $x"), "'C:\\team''s app; $x'")


if __name__ == "__main__":
    unittest.main()
