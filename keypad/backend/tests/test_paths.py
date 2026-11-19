import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class ProjectPathTests(unittest.TestCase):
    def test_precompute_finds_frontend_maps_outside_repository_cwd(self):
        module = load_module(
            "precompute_topn",
            REPOSITORY_ROOT / "keypad/backend/precompute_topn.py",
        )

        maps = module._load_json_anywhere("word_bigram_next.json")

        self.assertIn("the", maps)
        self.assertEqual(
            Path(module.DATA_DIR).resolve(),
            REPOSITORY_ROOT / "keypad/prediction-data",
        )

    def test_precompute_prefers_canonical_maps_over_caller_files(self):
        module = load_module(
            "precompute_topn",
            REPOSITORY_ROOT / "keypad/backend/precompute_topn.py",
        )
        original_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            (temporary / "word_bigram_next.json").write_text(
                json.dumps({"__caller_override__": [["input", 1]]})
            )
            try:
                os.chdir(temporary)
                maps = module._load_json_anywhere("word_bigram_next.json")
            finally:
                os.chdir(original_cwd)

        self.assertIn("the", maps)
        self.assertNotIn("__caller_override__", maps)

    def test_corpus_source_path_is_repository_relative(self):
        module = load_module(
            "build_prediction_maps",
            REPOSITORY_ROOT / "corpus-building/src/build_prediction_maps.py",
        )

        self.assertEqual(
            Path(module.FOLDER_PATH).resolve(),
            REPOSITORY_ROOT / "corpus-building/source-texts",
        )

    def test_trigram_maps_use_the_runtime_space_joined_key_format(self):
        module = load_module(
            "build_prediction_maps",
            REPOSITORY_ROOT / "corpus-building/src/build_prediction_maps.py",
        )

        serialized = module.serialize_word_trigram_map(
            {("in", "the"): [("world", 2)]}
        )

        self.assertEqual(serialized, {"in the": [("world", 2)]})

    def test_local_model_dependency_symbols_are_always_defined(self):
        module = load_module(
            "generate_corpus",
            REPOSITORY_ROOT / "corpus-building/src/generate_corpus.py",
        )

        self.assertTrue(hasattr(module, "torch"))
        self.assertTrue(hasattr(module, "AutoModelForCausalLM"))
        self.assertTrue(hasattr(module, "AutoTokenizer"))
        self.assertTrue(hasattr(module, "GenerationConfig"))

    def test_windows_launcher_avoids_cmd_quote_parsing(self):
        script = (REPOSITORY_ROOT / "keypad/scripts/start_all.ps1").read_text()

        self.assertNotIn('Start-Process -FilePath "cmd.exe"', script)
        self.assertIn("Start-Process -FilePath $pythonExe", script)
        self.assertIn("-RedirectStandardOutput $backendOutLog", script)
        self.assertIn("-RedirectStandardError $backendErrorLog", script)

    def test_windows_launcher_passes_backend_url_without_rewriting_env_file(self):
        script = (REPOSITORY_ROOT / "keypad/scripts/start_all.ps1").read_text()

        self.assertIn("$env:VITE_PREDICTOR_URL = $backendUrl", script)
        self.assertNotIn("Out-File", script)


if __name__ == "__main__":
    unittest.main()
