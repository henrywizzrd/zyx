import { ViewStyle } from 'react-native';
import { EdgeInsets } from 'react-native-safe-area-context';
import { Position, Theme } from '../theme/types';

export const ITEM_SIZE = 52;
export const DOCK_PADDING = 8;
export const DOCK_GAP = 6;
export const DOCK_THICKNESS = ITEM_SIZE + DOCK_PADDING * 2;

export const MP_ALBUM = 44;
export const MP_BUTTON = 40;
export const MP_PADDING = 8;
export const MP_GAP = 6;
export const MP_THICKNESS = MP_ALBUM + MP_PADDING * 2;

export const STACK_GAP = 10;

// Chỉ top và bottom nằm ngang, mọi vị trí còn lại xếp dọc
export const isVertical = (p: Position) => p !== 'top' && p !== 'bottom';

export function dockSize(count: number, position: Position) {
  const length = count * ITEM_SIZE + (count - 1) * DOCK_GAP + DOCK_PADDING * 2;
  return isVertical(position)
    ? { width: DOCK_THICKNESS, height: length }
    : { width: length, height: DOCK_THICKNESS };
}

// offset: đẩy thêm theo trục dọc (dùng khi xếp chồng 2 khối cùng vị trí)
function place(position: Position, insets: EdgeInsets, m: number, offset = 0): ViewStyle {
  const top = insets.top + m;
  const bottom = insets.bottom + m;
  const left = insets.left + m;
  const right = insets.right + m;

  switch (position) {
    case 'bottom':
      return { left: 0, right: 0, bottom: bottom + offset, alignItems: 'center' };
    case 'top':
      return { left: 0, right: 0, top: top + offset, alignItems: 'center' };
    case 'left':
      return { top: 0, bottom: 0, left, justifyContent: 'center' };
    case 'right':
      return { top: 0, bottom: 0, right, justifyContent: 'center' };
    case 'top-left':
      return { top: top + offset, left };
    case 'top-right':
      return { top: top + offset, right };
    case 'bottom-left':
      return { bottom: bottom + offset, left };
    case 'bottom-right':
      return { bottom: bottom + offset, right };
  }
}

export function computeLayout(theme: Theme, insets: EdgeInsets) {
  const { dock, miniPlayer } = theme;
  const m = dock.style.margin;
  const dockCount = dock.items.length + (miniPlayer.merged ? 1 : 0);
  const dSize = dockSize(dockCount, dock.position);

  let playerPosition = miniPlayer.position;
  let offset = 0;

  // Cùng vị trí với dock thì xếp chồng:
  // - bottom / bottom-left / bottom-right: dock dưới cùng, player nằm trên dock
  // - top / top-left / top-right: dock trên cùng, player nằm dưới dock
  // - left / right: player chuyển xuống góc dưới cùng bên đó (vẫn xếp dọc)
  if (!miniPlayer.merged && playerPosition === dock.position) {
    if (dock.position === 'left') playerPosition = 'bottom-left';
    else if (dock.position === 'right') playerPosition = 'bottom-right';
    else offset = dSize.height + STACK_GAP;
  }

  return {
    dockStyle: place(dock.position, insets, m),
    playerStyle: place(playerPosition, insets, m, offset),
    playerPosition,
  };
}