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

function partyPacket(members: PartyMember_T[], full = true) {
    const headerBytes = full ? 12 : 8;
    const membersBytes = members.reduce((size, member) => size + 4 + (member.name.length + 1) * 2 + 8 * 4 + 2 * 4, 0);
    const bytes = new Uint8Array(headerBytes + membersBytes);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    writeInt(view, offset, 7); offset += 4;
    writeInt(view, offset, 0); offset += 4;
    if (full) { writeInt(view, offset, members.length); offset += 4; }
    for (const member of members) {
        writeInt(view, offset, member.objectId); offset += 4;
        for (const char of member.name) { view.setUint16(offset, char.charCodeAt(0), true); offset += 2; }
        view.setUint16(offset, 0, true); offset += 2;
        for (const value of [member.curCp, member.maxCp, member.curHp, member.maxHp, member.curMp, member.maxMp, member.level, member.classId]) {
            writeInt(view, offset, value); offset += 4;
        }
        offset += 8; // The client parser skips two 32-bit unknown fields per member.
    }
    return new PacketReader(bytes.subarray(0, offset));
}

function renderedIds() { return slots.filter(slot => slot.member).map(slot => slot.member.objectId); }

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
const reappliedEffects: number[] = [];

const network = {
    actors: { userId: 99, objects: new Map() },
    ui: {
        addPartyMember: (member: PartyMember_T, leaderId: number, lootType: number) => NCPartyWnd.prototype.addMember.call(partyWnd, member, leaderId, lootType),
        deleteAllPartyMembers: () => partyWnd.deleteAll(),
        setPetStatusEffects: (spelled: { objectId: number }) => { reappliedEffects.push(spelled.objectId); },
        setMapPartyMembers: () => {}
    }
} as any;
const community = new NetworkCommunity(network);

community.onPartySmallWindowAll(partyPacket([partyMember(12, "Alice"), partyMember(13, "Bob")]));
assert(renderedIds().join(",") === "12,13", "Initial full roster should render both members.");

community.partyEffects.set(13, { objectId: 13 } as any);
community.onPartySmallWindowAll(partyPacket([partyMember(13, "Bob"), partyMember(14, "Carol")]));
assert(renderedIds().join(",") === "13,14", "Replacing [Alice, Bob] with [Bob, Carol] should remove Alice and keep one Bob row.");
assert([...community.partyMembers.keys()].join(",") === "13,14", "The party map should match the replacement roster.");
assert(reappliedEffects.join(",") === "13", "A full roster rebuild should restore cached effects only for retained members.");

community.onPartySmallWindowAdd(partyPacket([partyMember(15, "Bob")], false));
assert(renderedIds().join(",") === "13,14,15", "Distinct object IDs should remain distinct even when the displayed name matches.");
community.onPartySmallWindowAdd(partyPacket([partyMember(15, "Bob Updated")], false));
assert(renderedIds().join(",") === "13,14,15", "Repeated member-add packets should update rather than duplicate the same object ID.");
assert(slots.find(slot => slot.member?.objectId === 15)?.member?.name === "Bob Updated", "Repeated additions should refresh the existing member row.");

for (let objectId = 16; objectId <= 20; objectId++) {
    community.onPartySmallWindowAdd(partyPacket([partyMember(objectId, `Member${objectId}`)], false));
}
assert(renderedIds().length === 8, "Party window should fill to its eight-member capacity.");
community.onPartySmallWindowAdd(partyPacket([partyMember(13, "Bob Refreshed")], false));
assert(renderedIds().length === 8, "A duplicate add at capacity should update the existing row without requiring an empty slot.");
assert(slots.find(slot => slot.member?.objectId === 13)?.member?.name === "Bob Refreshed", "A duplicate add at capacity should refresh that member.");

community.onPartySmallWindowAll(partyPacket([]));
assert(renderedIds().length === 0, "An empty full roster should clear every visible row.");
assert(community.partyMembers.size === 0, "An empty full roster should clear the party map.");

console.log("Party roster replacement, effect restoration, object-ID upsert and capacity checks passed.");
