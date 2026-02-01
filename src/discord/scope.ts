/**
 * DM/ギルドのスコープIDを一貫して生成する
 * - ギルド内: guildId をそのまま返す
 * - DM: dm-${userId} を返す（ユーザーごとに分離）
 */
export const getScopeId = (guildId: string | null | undefined, userId: string): string =>
  guildId ?? `dm-${userId}`;
