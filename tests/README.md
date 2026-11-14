# Physics volume lifecycle regression

After installing the project dependencies, run:

```sh
node tests/run-retired-volume-zone-events.cjs
```

The test uses the actual actor release and pawn movement/zone-transition code
with an isolated collision fixture. It needs no game assets, server, browser or
GPU. It covers released and releasing volume hosts, live-volume callbacks,
retired zones and preservation of errors on live hosts missing their script.
