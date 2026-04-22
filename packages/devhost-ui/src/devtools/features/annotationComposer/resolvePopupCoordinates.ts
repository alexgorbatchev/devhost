export interface IResolvePopupCoordinatesOptions {
  anchorBottom: number;
  anchorLeft: number;
  anchorTop: number;
  popupHeight: number;
  popupWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  viewportPadding: number;
}

export interface IPopupCoordinates {
  left: number;
  top: number;
}

const popupOffset: number = 12;

export function resolvePopupCoordinates(options: IResolvePopupCoordinatesOptions): IPopupCoordinates {
  const fitsOnRight: boolean = options.anchorLeft + options.popupWidth + popupOffset <= options.viewportWidth;
  const preferredLeft: number = fitsOnRight
    ? options.anchorLeft + popupOffset
    : options.anchorLeft - options.popupWidth - popupOffset;
  const left: number = clamp(
    preferredLeft,
    options.viewportPadding,
    Math.max(options.viewportPadding, options.viewportWidth - options.popupWidth - options.viewportPadding),
  );
  const preferredTop: number = options.anchorTop;
  const maxTop: number = Math.max(
    options.viewportPadding,
    options.viewportHeight - options.popupHeight - options.viewportPadding,
  );
  const top: number = clamp(preferredTop, options.viewportPadding, maxTop);

  if (preferredTop > maxTop && options.anchorBottom < options.viewportHeight) {
    return {
      left,
      top: maxTop,
    };
  }

  return {
    left,
    top,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
