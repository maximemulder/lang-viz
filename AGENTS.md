# Agent directives

After changing Python files, run the repository's Python static checks from the repository root:

```sh
uv run pyrefly check
uv run ruff check
```

Report any failures. Ruff's target paths and executable-bit handling are configured in `pyproject.toml`.
