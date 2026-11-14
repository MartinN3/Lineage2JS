# Party roster regression

After installing the repository dependencies, run the focused party snapshot
and duplicate-add regression with:

```sh
node tests/run-party-roster.cjs
```

The runner bundles the real party packet handlers and party window class, then
exercises them with a small mocked UI. It does not start a game server or
create a browser or GPU context.
