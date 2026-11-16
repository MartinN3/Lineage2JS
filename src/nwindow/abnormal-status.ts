import type { AbnormalStatus_T } from "../network/game-packets";

type SkillInfo_T = { isToggle?: boolean };

export type AbnormalStatusView_T = {
    activeSkills: Set<string>;
    visibleEffects: AbnormalStatus_T[];
};

export type AbnormalStatusLayout_T = { width: number; height: number; rows: number };

export function getAbnormalStatusLayout(count: number, secondaryCount: number): AbnormalStatusLayout_T {
    const rows = Math.ceil(Math.min(count, 30) / 10);

    return {
        width: count > 10 ? 272 : count || secondaryCount ? 12 + Math.max(count, secondaryCount) * 26 : 0,
        height: secondaryCount ? 26 + rows * 25 : count ? 1 + rows * 25 : 0,
        rows
    };
}

export function getAbnormalStatusSlotIndex(x: number, y: number) {
    const column = Math.floor((x - 13) / 26);
    const row = Math.floor((y - 1) / 25);

    return x < 13 || y < 1 || column < 0 || column >= 10 || row < 0 || row > 3 ? -1 : row * 10 + column;
}

export function isIndefiniteToggle(effect: AbnormalStatus_T, skillInfos: Record<string, SkillInfo_T>) {
    return effect.duration === 2147483647 && skillInfos[`${effect.id}:${effect.level}`]?.isToggle === true;
}

/** Keep toggle statuses in the bounded display while deriving their highlights. */
export function getAbnormalStatusView(effects: AbnormalStatus_T[], skillInfos: Record<string, SkillInfo_T>): AbnormalStatusView_T {
    const activeSkills = new Set<string>();

    for (const effect of effects) {
        const key = `${effect.id}:${effect.level}`;

        if (skillInfos[key]?.isToggle) activeSkills.add(key);
    }

    return { activeSkills, visibleEffects: effects.slice(0, 31) };
}
