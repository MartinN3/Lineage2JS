import { getAbnormalStatusLayout, getAbnormalStatusSlotIndex, getAbnormalStatusView, isIndefiniteToggle } from "../src/nwindow/abnormal-status";
import type { AbnormalStatus_T } from "../src/network/game-packets";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function runAbnormalStatusChecks() {
    const buffs: AbnormalStatus_T[] = Array.from({ length: 20 }, (_, index) => ({ id: 1000 + index, level: 1, duration: 300 }));
    const accuracy: AbnormalStatus_T = { id: 256, level: 1, duration: 2147483647 };
    const viciousStance: AbnormalStatus_T = { id: 312, level: 1, duration: 2147483647 };
    const serverEffects = [...buffs, accuracy, viciousStance];
    const skillInfos = {
        "256:1": { isToggle: true },
        "312:1": { isToggle: true },
        "1000:1": { isToggle: false }
    };

    const view = getAbnormalStatusView(serverEffects, skillInfos);
    assert(view.visibleEffects.length === 22, "twenty ordinary buffs and two toggles must all remain visible");
    assert(view.visibleEffects.every((effect, index) => effect === serverEffects[index]), "visible effect identity and order must be preserved");
    assert(view.activeSkills.size === 2 && view.activeSkills.has("256:1") && view.activeSkills.has("312:1"), "server-reported toggles must keep skill and shortcut highlighting active");
    assert(!view.activeSkills.has("1000:1"), "ordinary buffs must not be highlighted as toggles");
    assert(isIndefiniteToggle(accuracy, skillInfos) && !isIndefiniteToggle({ ...accuracy, duration: 15 }, skillInfos), "only the infinite duration sentinel on a known toggle may suppress its countdown");

    const layout = getAbnormalStatusLayout(view.visibleEffects.length, 0);
    const firstToggle = { x: 13, y: 51 }, secondToggle = { x: 39, y: 51 };
    assert(layout.rows === 3 && layout.width === 272 && layout.height === 76, "twenty-two statuses must allocate a complete third row");
    assert(firstToggle.x === 13 && secondToggle.x === 39 && firstToggle.y === 51 && secondToggle.y === 51, "the two toggles must occupy separate visible slots in row three");
    assert(firstToggle.x + 24 < layout.width && secondToggle.x + 24 < layout.width && firstToggle.y + 24 < layout.height, "both toggle icons must fit inside the status window bounds");
    assert(getAbnormalStatusSlotIndex(firstToggle.x + 12, firstToggle.y + 12) === 20 && getAbnormalStatusSlotIndex(secondToggle.x + 12, secondToggle.y + 12) === 21, "hovering either third-row toggle must resolve to its own status slot");

    const reset = getAbnormalStatusView([], skillInfos);
    assert(reset.visibleEffects.length === 0 && reset.activeSkills.size === 0, "reset must remove status icons and active toggle highlighting");

    const overflowToggle: AbnormalStatus_T = { id: 9999, level: 1, duration: 100 };
    const oversizedEffects = [...serverEffects, ...Array.from({ length: 10 }, (_, index) => ({ id: 5000 + index, level: 1, duration: 300 })), overflowToggle];
    const oversizedView = getAbnormalStatusView(oversizedEffects, { ...skillInfos, "9999:1": { isToggle: true } });
    assert(oversizedView.visibleEffects.length === 31 && !oversizedView.visibleEffects.includes(overflowToggle), "the prior 31-entry status list bound must remain in place");
    assert(oversizedView.activeSkills.has("9999:1"), "toggle highlighting must still consider server effects beyond the visible list cap");
    return "Twenty buffs plus two active toggles, three-row layout, and reset checks passed";
}

try { (globalThis as any).abnormalStatusResult = { passed: true, message: runAbnormalStatusChecks() }; }
catch (error) { (globalThis as any).abnormalStatusResult = { passed: false, error: `${(error as Error).name}: ${(error as Error).message}\n${(error as Error).stack || ""}` }; }
