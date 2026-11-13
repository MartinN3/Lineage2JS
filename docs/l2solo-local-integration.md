# Local L2Solo integration

This experimental branch is based on the client `optimize` branch at `f1264da780f80807cb90c62b085ce88f4b53477b`. It preserves the local integration used during runtime testing; it is not merged into `optimize`.

Use it with the [`fix/lineage2js-optimize-browser-compat` branch of MartinN3/L2Solo](https://github.com/MartinN3/L2Solo/tree/fix/lineage2js-optimize-browser-compat). Server-side login fields, packet layouts and mount state require the corresponding server fixes. Native client compatibility has not been verified.

## Start locally

1. Install dependencies. The upstream dependency manifest currently omits Babel plugins required by webpack. Until client PR #3 (issue #2) is merged, install the three `@babel/plugin-proposal-class-properties`, `@babel/plugin-proposal-private-methods` and `@babel/plugin-proposal-private-property-in-object` packages locally. The upstream lockfile may require `npm install` rather than `npm ci` with recent npm releases. The git dependencies may require GitHub SSH access, or a command-scoped HTTPS rewrite.
2. For the bridge, install `ws@7` locally if it is not already resolvable: `npm install --no-save ws@7`. This bridge uses the v7 binary-message API.
3. Start the compatible L2Solo server with its login and game TCP listeners on `127.0.0.1:2106` and `127.0.0.1:7777`. Node 24 was used for the tested setup.
4. Run `node local/l2solo-bridge.cjs` in this repository.
5. Run `npm start -- --host 127.0.0.1`.
6. Open `http://127.0.0.1:8080/?login&gameBridgePort=7778&l2solo`. Select your legally obtained Chronicle 4 client directory or installer cabinets in the game-file picker.

The bridge listens only on localhost. `gameBridgePort` overrides the advertised game TCP port for the browser WebSocket, including server pings. `l2solo` disables game-packet encryption because this server sends plaintext game packets; login encryption stays enabled. Do not use this mode for remote or public deployments.

## Runtime evidence and limits

The local combination was tested through graphical login, character creation, world entry, click-to-move and combat with a Gremlin. Strider mounting was subsequently confirmed by the player after a server mount-state correction. The server's full strider movement-speed preference is a separate local gameplay customization.

The bridge, plaintext mode and port override need further hardening before a general client PR. No game assets, accounts, credentials, saved worlds or browser test profiles are included in this branch.
