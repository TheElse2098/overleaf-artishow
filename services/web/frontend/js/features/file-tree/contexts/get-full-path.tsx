import { Folder } from '../../../../../types/folder'
import { findInTree } from '@/features/file-tree/util/find-in-tree'

export function getFullPath(fileTreeData: Folder, entityId: string): string {
  let path = '';
  let currentEntity = findInTree(fileTreeData, entityId);

  while (currentEntity) {
    path = `/${currentEntity.entity.name}${path}`;
    currentEntity = findInTree(fileTreeData, currentEntity.parentFolderId);
  }

  return path;
}
