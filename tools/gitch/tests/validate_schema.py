#!/usr/bin/env python3
"""Optional formal validation for public CLI fixtures (requires jsonschema).

Set GITCH_JSONSCHEMA_PYTHON to a Python with jsonschema when running run.sh.
The regular shell suite still checks contracts without installing packages.
"""

import json
import sys

from jsonschema import Draft202012Validator, FormatChecker

with open(sys.argv[1], encoding="utf-8") as schema_file:
    schema = json.load(schema_file)
with open(sys.argv[2], encoding="utf-8") as payload_file:
    payload = json.load(payload_file)
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)
