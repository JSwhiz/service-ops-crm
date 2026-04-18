import { hasWideObjectAccess as hasWideObjectCoreAccess } from '../../objects/utils/object-access.util';

export function hasWideObjectAccess(roleCodes: string[]): boolean {
  return hasWideObjectCoreAccess(roleCodes);
}
