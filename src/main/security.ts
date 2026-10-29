export type PermissionDetails = {
  mediaTypes?: string[];
  mediaType?: string;
};

export function getMediaTypes(details: PermissionDetails): string[] {
  if (details.mediaTypes && details.mediaTypes.length > 0) {
    return details.mediaTypes;
  }
  if (details.mediaType) {
    return [details.mediaType];
  }
  return [];
}

export function isAllowedPermission(
  permission: string,
  details: PermissionDetails = {},
): boolean {
  if (permission !== 'media') {
    return false;
  }
  const mediaTypes = getMediaTypes(details);
  return mediaTypes.includes('audio') && !mediaTypes.includes('video');
}
