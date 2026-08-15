export const safeUserSelect = {
  id: true,
  username: true,
  displayName: true,
} as const;

export const publicUserSelect = safeUserSelect;
