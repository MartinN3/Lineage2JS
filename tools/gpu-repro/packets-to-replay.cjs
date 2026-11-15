'use strict';
// Convert the bounded, chat-free gameplay packet JSONL into a normal LineageII .l2r.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const INPUT = process.argv[2] ? path.resolve(process.argv[2]) : '';
const OUTPUT = process.argv[3] ? path.resolve(process.argv[3]) : '';
const TS = require(process.env.GPU_REPRO_TYPESCRIPT_MODULE || 'typescript');
const REPLAYABLE = new Set([1,3,4,5,6,7,11,12,13,18,22,28,29,40,41,43,44,45,46,47,71,72,73,75,76,77,89,90,91,92,93,96,97,98,99,113,114,115,118,127,134,137,140,152,153,159,181,182,186,196,197,199,200,212,221,225,241,247,264,266,274,275,276,277]);

function emit(step, metadata = {}) { console.log(JSON.stringify({ utc: new Date().toISOString(), step, ...metadata })); }
function loadTs(filename, cache = new Map()) {
 filename = path.resolve(filename);
 if (cache.has(filename)) return cache.get(filename).exports;
 const source = fs.readFileSync(filename, 'utf8');
 const output = TS.transpileModule(source, { compilerOptions: { module: TS.ModuleKind.CommonJS, target: TS.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
 const mod = new Module(filename, module);
 mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(filename, mod);
 const nativeRequire = mod.require.bind(mod);
 mod.require = request => {
  if (request.startsWith('.')) {
   const resolved = path.resolve(path.dirname(filename), request);
   const tsPath = `${resolved}.ts`;
   if (fs.existsSync(tsPath)) return loadTs(tsPath, cache);
  }
  return nativeRequire(request);
 };
 mod._compile(output, filename);
 return mod.exports;
}
function readJsonl(file) {
 const stat = fs.statSync(file);
 if (!stat.isFile() || stat.size < 1 || stat.size > 16 * 1024 * 1024) throw new Error('Input must be a regular JSONL file between 1 byte and 16 MiB.');
 const rows = [];
 for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); } catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
 }
 return rows;
}
function packetObjectId(opcode, payload) {
 if (![3,4,22,140].includes(opcode)) return null; // CharInfo, UserInfo, NpcInfo, ServerObjectInfo.
 const offset = opcode === 3 || opcode === 4 ? 16 : 0;
 if (payload.byteLength < offset + 4) return null;
 return new DataView(payload.buffer, payload.byteOffset + offset, 4).getInt32(0, true);
}
function sceneFrom(metadata, sceneRecord) {
 const scene = metadata?.scene || sceneRecord?.scene || sceneRecord || metadata;
 if (!scene || !Array.isArray(scene.position) || scene.position.length !== 3) throw new Error('Metadata must include scene.position with three finite numbers.');
 const pick = (key, fallback) => scene[key] === undefined ? fallback : scene[key];
 const result = { position: scene.position.map(Number), yaw: Number(pick('yaw', 0)), pitch: Number(pick('pitch', 0)),
  zoom: Number(pick('zoom', 300)), desiredZoom: Number(pick('desiredZoom', pick('zoom', 300))),
  hour: Number(pick('hour', 12)), minute: Number(pick('minute', 0)), second: Number(pick('second', 0)), duration: 0,
  cameraMode: Number(pick('cameraMode', 0)), firstPerson: Number(pick('firstPerson', 0)), observerMode: Number(pick('observerMode', 0)),
  actorYaw: Number(pick('actorYaw', 0)), fixedCamera: Number(pick('fixedCamera', 0)) };
 if (result.position.some(value => !Number.isFinite(value)) || Object.entries(result).some(([key, value]) => key !== 'position' && key !== 'duration' && !Number.isFinite(value)))
  throw new Error('Replay scene metadata contains non-finite values.');
 if (result.cameraMode !== 0) throw new Error('Replay cameraMode must be 0; this client does not implement walking-camera replay.');
 return result;
}
function main() {
 if (!/\.l2r$/i.test(OUTPUT)) throw new Error('Output replay path must end in .l2r.');
 if (fs.existsSync(OUTPUT.replace(/\.l2r$/i, '.json'))) throw new Error('Output metadata already exists; choose a new path.');
 if (!INPUT || !OUTPUT) throw new Error('Usage: node packets-to-replay.cjs <input.jsonl> <output.l2r>');
 const rows = readJsonl(INPUT), metadata = rows.find(row => row.type === 'meta'), sceneRecord = rows.find(row => row.type === 'scene');
 if (!metadata) throw new Error('JSONL metadata row is missing.');
 const scene = sceneFrom(metadata, sceneRecord), end = [...rows].reverse().find(row => row.type === 'end');
 const packetRows = rows.filter(row => row.type === 'packet');
 if (!packetRows.length) throw new Error('No gameplay packets were captured.');
 const { default: L2ReplayFile } = loadTs(path.join(ROOT, 'src/network/l2-replay-file.ts'));
 const file = new L2ReplayFile();
 const start = packetRows.find(row => row.opcode === 4);
 if (!start || start !== packetRows[0]) throw new Error('First captured replay packet must be UserInfo opcode 4.');
 let lastTime = -Infinity, firstTime = Number(start.time ?? start.t);
 const initialIds = new Set((Array.isArray(metadata.arrUserIds) ? metadata.arrUserIds : Array.isArray(metadata.userIds) ? metadata.userIds : []).map(Number));
 let reachedTeleport = false, droppedChat = 0, droppedNonReplayable = 0;
 const decoded = [];
 for (const row of packetRows) {
  const opcode = Number(row.opcode), extendedOpcode = Number(row.extendedOpcode ?? -1);
  const index = opcode === 254 ? 255 + extendedOpcode : opcode;
  if (index === 2 || index === 74) { droppedChat++; continue; }
  if (!REPLAYABLE.has(index)) { droppedNonReplayable++; continue; }
  const time = Number(row.time ?? row.t);
  if (!Number.isFinite(time) || time < firstTime || time < lastTime) throw new Error('Packet times must be finite, nonnegative, and ordered.');
  const encoded = row.payload ?? row.payloadB64;
  if (typeof encoded !== 'string') throw new Error(`Packet opcode ${opcode} has no base64 payload.`);
  const payload = Buffer.from(encoded, 'base64');
  if (payload.length > 2 * 1024 * 1024 || payload.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error(`Invalid/oversized base64 packet payload for opcode ${opcode}.`);
  if (opcode === 40) reachedTeleport = true;
  if (!end || time <= Number(end.duration ?? Infinity)) {
   if (!initialIds.size && !reachedTeleport) {
    const id = packetObjectId(opcode, payload);
    if (id > 0) initialIds.add(id);
   }
   decoded.push({ time: time - firstTime, opcode, extendedOpcode, payload: new Uint8Array(payload), extraByte: 0 });
  }
  lastTime = time;
 }
 if (!decoded.length || decoded[0].opcode !== 4 || decoded[0].time !== 0) throw new Error('Serialized replay must begin at time zero with UserInfo opcode 4.');
 if (!initialIds.size) {
  const id = packetObjectId(decoded[0].opcode, decoded[0].payload);
  if (id > 0) initialIds.add(id);
 }
 const duration = Number(end?.duration ?? lastTime - firstTime);
 if (!Number.isFinite(duration) || duration < 0 || duration > 120) throw new Error('Replay duration must be finite and at most 120 seconds.');
 scene.duration = duration;
 file.setScene(scene);
 file.arrPackets = decoded;
 file.arrUserIds = [...initialIds].filter(id => Number.isSafeInteger(id) && id > 0);
 const bytes = file.toBytes(), validated = new L2ReplayFile(bytes), validatedScene = validated.getScene();
 if (validated.arrPackets[0]?.opcode !== 4 || validated.arrPackets[0]?.time !== 0) throw new Error('Serialized .l2r failed initial UserInfo validation.');
 const teleportCount = validated.arrPackets.filter(packet => packet.opcode === 40).length;
 fs.mkdirSync(path.dirname(OUTPUT), { recursive: true, mode: 0o700 });
 if (fs.existsSync(OUTPUT)) throw new Error('Output replay already exists; choose a new path.');
 const temporary = `${OUTPUT}.${process.pid}.${Date.now()}.tmp`;
 fs.writeFileSync(temporary, bytes, { mode: 0o600 }); fs.renameSync(temporary, OUTPUT);
 const summary = { output: path.relative(ROOT, OUTPUT), input: path.relative(ROOT, INPUT), bytes: bytes.byteLength,
  packetCount: validated.arrPackets.length, cameraInstructions: validated.arrCameraInstructions.length,
  userIds: validated.arrUserIds.length, firstOpcode: validated.arrPackets[0].opcode, hasInitialUserInfo: true,
  teleportCount, hasTeleport: teleportCount > 0, duration: validatedScene.duration, scene: validatedScene,
  chatPacketsExcluded: droppedChat, nonReplayablePacketsExcluded: droppedNonReplayable,
  note: 'This converts captured allowlisted packets. A zero teleportCount is not a teleport replay.' };
 const metadataPath = OUTPUT.replace(/\.l2r$/i, '.json');
 const metadataTemp = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
 fs.writeFileSync(metadataTemp, JSON.stringify(summary, null, 2), { mode: 0o600 }); fs.renameSync(metadataTemp, metadataPath);
 emit('converted-replay', summary);
}
try { main(); } catch (error) { emit('conversion-failed', { message: error.message, stack: error.stack?.slice(0, 1200) }); process.exitCode = 1; }
