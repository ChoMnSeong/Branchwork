"""Small SCIP producer for integration tests, using public protocol field numbers.

This encoder deliberately does not import the consumer. The fixtures describe
cross-file definitions and references, not import-name guesses.
"""

import json
from pathlib import Path


def vint(value):
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def number(field, value):
    return vint(field << 3) + vint(value)


def blob(field, value):
    value = value.encode("utf-8") if isinstance(value, str) else value
    return vint(field << 3 | 2) + vint(len(value)) + value


def encode(index, unpacked=False):
    metadata = index["metadata"]
    producer = metadata.get("tool_info", {})
    payload = blob(1, blob(2, blob(1, producer.get("name", "fixture-indexer")) + blob(2, producer.get("version", "1")))
                   + blob(3, metadata["project_root"]) + number(4, metadata.get("text_document_encoding", 1)))
    for document in index.get("documents", []):
        message = blob(1, document["relative_path"]) + blob(4, document.get("language", ""))
        if "text" in document:
            message += blob(5, document["text"])
        message += number(6, document.get("position_encoding", 3))
        for occurrence in document.get("occurrences", []):
            positions = occurrence.get("range", [])
            if unpacked:
                item = b"".join(number(1, value) for value in positions)
            else:
                item = blob(1, b"".join(vint(value) for value in positions))
            item += blob(2, occurrence["symbol"]) + number(3, occurrence.get("symbol_roles", 0))
            for name, field, keys in (("single_line_range", 8, ("line", "start_character", "end_character")),
                                      ("multi_line_range", 9, ("start_line", "start_character", "end_line", "end_character"))):
                if name in occurrence:
                    item += blob(field, b"".join(number(i + 1, occurrence[name].get(key, 0)) for i, key in enumerate(keys)))
            message += blob(2, item)
        payload += blob(2, message)
    for symbol in index.get("external_symbols", []):
        payload += blob(3, blob(1, symbol["symbol"]))
    return payload


def occurrence(text, token, line, symbol, roles=0, *, after=0):
    column = text.split("\n")[line].index(token, after)
    return {"range": [line, column, column + len(token)], "symbol": symbol, "symbol_roles": roles}


def fixture(repo):
    repo = Path(repo)
    sources = {
        "ts/engine.ts": "export class Engine {}\nexport function make() { return new Engine(); }\n",
        "ts/client.ts": 'import { Engine, make } from "./engine";\nconst e = new Engine();\nmake();\n',
        "ts/unrelated.ts": "export class Engine {}\n",
        "python/engine.py": "class Engine:\n    def run(self): return 1\n\ndef make(): return Engine()\n",
        "python/client.py": "from engine import Engine, make\ne = Engine()\nmake()\n",
        "java/Engine.java": "package demo;\npublic class Engine { public int run() { return 1; } }\n",
        "java/Client.java": "package demo;\nclass Client { int value = new Engine().run(); }\n",
    }
    for relative, text in sources.items():
        file = repo / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        # SCIP Document.text below represents these exact bytes. Native Windows
        # text writes would otherwise change LF to CRLF behind the producer.
        file.write_bytes(text.encode("utf-8"))
    symbols = {
        "ts_engine": "scip-typescript npm demo 1.0.0 ts/engine.ts/Engine#",
        "ts_make": "scip-typescript npm demo 1.0.0 ts/engine.ts/make().",
        "ts_other": "scip-typescript npm demo 1.0.0 ts/unrelated.ts/Engine#",
        "py_engine": "scip-python python demo 1 python.engine/Engine#",
        "py_make": "scip-python python demo 1 python.engine/make().",
        "java_engine": "semanticdb maven demo 1 demo/Engine#",
        "java_run": "semanticdb maven demo 1 demo/Engine#run().",
    }
    def doc(path, language, references):
        text = sources[path]
        return {"relative_path": path, "language": language, "text": text, "position_encoding": 3,
                "occurrences": [occurrence(text, token, line, symbols[symbol], roles) for token, line, symbol, roles in references]}
    documents = [
        doc("ts/engine.ts", "TypeScript", [("Engine", 0, "ts_engine", 1), ("make", 1, "ts_make", 1), ("Engine", 1, "ts_engine", 0)]),
        doc("ts/client.ts", "TypeScript", [("Engine", 0, "ts_engine", 2), ("make", 0, "ts_make", 2), ("Engine", 1, "ts_engine", 0), ("make", 2, "ts_make", 0)]),
        doc("ts/unrelated.ts", "TypeScript", [("Engine", 0, "ts_other", 1)]),
        doc("python/engine.py", "Python", [("Engine", 0, "py_engine", 1), ("make", 3, "py_make", 1), ("Engine", 3, "py_engine", 0)]),
        doc("python/client.py", "Python", [("Engine", 0, "py_engine", 2), ("make", 0, "py_make", 2), ("Engine", 1, "py_engine", 0), ("make", 2, "py_make", 0)]),
        doc("java/Engine.java", "Java", [("Engine", 1, "java_engine", 1), ("run", 1, "java_run", 1)]),
        doc("java/Client.java", "Java", [("Engine", 1, "java_engine", 0), ("run", 1, "java_run", 0)]),
    ]
    return {"metadata": {"project_root": repo.resolve().as_uri(), "tool_info": {"name": "fixture-indexer", "version": "1"}}, "documents": documents}


def write_fixture(repo):
    repo = Path(repo)
    index = fixture(repo)
    (repo / "index.scip").write_bytes(encode(index))
    (repo / "tracked.z").write_bytes(b"\0".join(document["relative_path"].encode() for document in index["documents"]) + b"\0")
    return index


if __name__ == "__main__":
    import sys
    print(json.dumps(write_fixture(sys.argv[1])))
