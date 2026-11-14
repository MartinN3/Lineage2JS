import { NetworkCommunity } from "../src/network/network-community";
import PacketReader from "../src/network/packet-reader";
import { NCPartyWnd } from "../src/nwindow/nc-party-wnd";
import type { PartyMember_T } from "../src/network/game-packets";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function partyMember(objectId: number, name: string): PartyMember_T {
    return { objectId, name, curCp: 10, maxCp: 10, curHp: 20, maxHp: 20, curMp: 30, maxMp: 30, level: 1, classId: 1 };
}

function writeInt(view: DataView, offset: number, value: number) { view.setInt32(offset, value, true); }

function partyPacket(member: PartyMember_T, full = true) {
    const encodedName = Array.from(member.name, char => char.charCodeAt(0));
    const headerBytes = full ? 12 : 8;
    const bytes = new Uint8Array(headerBytes + 4 + encodedName.length * 2 + 2 + 8 * 4 + 4 * 4);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    writeInt(view, offset, 7); offset += 4;
    writeInt(view, offset, 0); offset += 4;
    if (full) { writeInt(view, offset, 1); offset += 4; }
    writeInt(view, offset, member.objectId); offset += 4;
    for (const code of encodedName) { view.setUint16(offset, code, true); offset += 2; }
    view.setUint16(offset, 0, true); offset += 2;
    for (const value of [member.curCp, member.maxCp, member.curHp, member.maxHp, member.curMp, member.maxMp, member.level, member.classId]) {
        writeInt(view, offset, value); offset += 4;
    }
    offset += 16; // PartySmallWindowAll member padding.
    return new PacketReader(bytes.subarray(0, offset));
}

const slots = Array.from({ length: 8 }, () => ({ member: null as PartyMember_T | null, leaderId: 0, lootType: 0,
    isEmpty() { return !this.member; },
    setMember(member: PartyMember_T, leaderId: number, lootType: number) { this.member = member; this.leaderId = leaderId; this.lootType = lootType; },
    reset() { this.member = null; }
}));
const partyWnd = Object.create(NCPartyWnd.prototype) as any;
partyWnd.arrMembers = slots;
partyWnd.setVisible = () => {};
partyWnd.update = () => {};
partyWnd.loadIcons = async () => {};
partyWnd.deleteAll = () => { for (const slot of slots) slot.reset(); };
let effectsReapplied = 0;

const network = {
    actors: { userId: 99, objects: new Map() },
    ui: {
        addPartyMember: (member: PartyMember_T, leaderId: number, lootType: number) => NCPartyWnd.prototype.addMember.call(partyWnd, member, leaderId, lootType),
        deleteAllPartyMembers: () => partyWnd.deleteAll(),
        setPetStatusEffects: () => { effectsReapplied++; },
        setMapPartyMembers: () => {}
    }
} as any;
const community = new NetworkCommunity(network);

community.onPartySmallWindowAll(partyPacket(partyMember(12, "MARTINO")));
assert(slots.filter(slot => slot.member).length === 1, "Initial full roster should render one party row.");
community.partyEffects.set(12, { objectId: 12 } as any);
community.onPartySmallWindowAll(partyPacket(partyMember(12, "MARTINO")));
assert(slots.filter(slot => slot.member).length === 1, "Replacing a full roster with the same member should not duplicate its row.");
assert(effectsReapplied === 1, "A full roster rebuild should restore cached party effects for retained members.");

community.onPartySmallWindowAll(partyPacket(partyMember(12, "MARTINO")));
const refreshedMember = partyMember(12, "MARTINO Updated");
community.onPartySmallWindowAdd(partyPacket(refreshedMember, false));
assert(slots.filter(slot => slot.member).length === 1, "Repeated member-add packets should update the row by object ID.");
assert(slots.find(slot => slot.member)?.member?.name === "MARTINO Updated", "Repeated member-add packets should refresh the existing row.");

console.log("Party roster snapshots replace existing rows and duplicate member additions update by object ID.");
