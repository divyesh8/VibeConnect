export const DISPLAY_NAME_MAX_LENGTH = 30;

export function trimDisplayName(value: string) {
  return value.trim();
}

export function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

export function displayNameValidationError(value: string) {
  const trimmed = trimDisplayName(value);
  if (Array.from(trimmed).length < 1) return "Enter at least one visible character.";
  if (Array.from(trimmed).length > DISPLAY_NAME_MAX_LENGTH) return `Keep your display name to ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  if (hasControlCharacters(trimmed)) return "Control characters are not allowed.";
  return null;
}
