export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LensPoint {
  x: number;
  y: number;
}

export interface LensGeometry {
  left: number;
  top: number;
  diameter: number;
  backgroundWidth: number;
  backgroundHeight: number;
  backgroundX: number;
  backgroundY: number;
}

/** Returns no lens when the pointer falls in letterboxing around the source image. */
export function getLensGeometry(
  point: LensPoint,
  imageRect: ViewportRect,
  viewport: ViewportRect,
  naturalWidth: number,
  naturalHeight: number,
  zoom = 2,
  requestedDiameter = 180,
): LensGeometry | null {
  if (
    ![point.x, point.y, imageRect.left, imageRect.top, imageRect.width, imageRect.height,
      viewport.left, viewport.top, viewport.width, viewport.height, naturalWidth, naturalHeight,
      zoom, requestedDiameter].every(Number.isFinite) ||
    imageRect.width <= 0 || imageRect.height <= 0 || viewport.width <= 0 || viewport.height <= 0 ||
    naturalWidth <= 0 || naturalHeight <= 0 || zoom <= 0 || requestedDiameter <= 0
  ) return null;

  const containScale = Math.min(imageRect.width / naturalWidth, imageRect.height / naturalHeight);
  const contentWidth = naturalWidth * containScale;
  const contentHeight = naturalHeight * containScale;
  const contentLeft = imageRect.left + (imageRect.width - contentWidth) / 2;
  const contentTop = imageRect.top + (imageRect.height - contentHeight) / 2;
  const contentRight = contentLeft + contentWidth;
  const contentBottom = contentTop + contentHeight;

  if (point.x < contentLeft || point.x > contentRight || point.y < contentTop || point.y > contentBottom) {
    return null;
  }

  const diameter = Math.min(requestedDiameter, viewport.width, viewport.height);
  const minimumScale = Math.max(diameter / contentWidth, diameter / contentHeight);
  const scale = Math.max(zoom, minimumScale);
  const backgroundWidth = contentWidth * scale;
  const backgroundHeight = contentHeight * scale;
  const localX = point.x - contentLeft;
  const localY = point.y - contentTop;
  const backgroundX = Math.min(0, Math.max(diameter - backgroundWidth, diameter / 2 - localX * scale));
  const backgroundY = Math.min(0, Math.max(diameter - backgroundHeight, diameter / 2 - localY * scale));
  const centerX = Math.min(
    viewport.left + viewport.width - diameter / 2,
    Math.max(viewport.left + diameter / 2, point.x),
  );
  const centerY = Math.min(
    viewport.top + viewport.height - diameter / 2,
    Math.max(viewport.top + diameter / 2, point.y),
  );

  return {
    left: centerX - diameter / 2,
    top: centerY - diameter / 2,
    diameter,
    backgroundWidth,
    backgroundHeight,
    backgroundX,
    backgroundY,
  };
}
